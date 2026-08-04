import assert from "node:assert/strict";
import test from "node:test";
import {
  handleDependencyHealthRequest,
  resetDependencyHealthCacheForTests,
} from "../worker/dependency-health.ts";

function migrationDatabase() {
  return {
    prepare() { return {}; },
    batch() { return Promise.resolve([]); },
  };
}

function schemaStatus(state = "ready") {
  return {
    state,
    currentVersion: state === "ready" ? 3 : 2,
    latestVersion: 3,
    appliedVersions: state === "ready" ? [1, 2, 3] : [1, 2],
    pendingVersions: state === "ready" ? [] : [3],
    compatibleDrift: [],
    incompatibleDrift: state === "ready" ? [] : ["drift-secret-sentinel"],
    errorCode: state === "ready" ? "" : "schema_incompatible_drift",
    verifiedAt: 1,
  };
}

function configuration(overrides = {}) {
  return {
    demoMode: false,
    updatedAt: 1,
    freeipa: {
      url: "https://freeipa.secret.example",
      username: "directory-user-sentinel",
      password: "directory-password-sentinel",
    },
    xyops: {
      url: "https://xyops.secret.example",
      apiKey: "xyops-api-key-sentinel",
    },
    gateway: {
      url: "http://127.0.0.1:43123",
      token: "gateway-token-sentinel",
    },
    ...overrides,
  };
}

function request() {
  return new Request("https://portal.test/health/dependencies");
}

async function body(response) {
  return await response.json();
}

function dependency(payload, name) {
  return payload.dependencies.find((item) => item.name === name);
}

test.beforeEach(() => resetDependencyHealthCacheForTests());

test("dependency health ignores non-matching routes", async () => {
  const response = await handleDependencyHealthRequest(
    new Request("https://portal.test/health/live"),
    {},
    { portalSchema: async () => schemaStatus(), loadConfiguration: async () => configuration(), fetchImpl: fetch },
  );
  assert.equal(response, null);
});

test("dependency health fails closed before probes when DB or schema is unavailable", async () => {
  let loadCalls = 0;
  let fetchCalls = 0;
  const missingDb = await handleDependencyHealthRequest(request(), {}, {
    portalSchema: async () => { throw new Error("must not run"); },
    loadConfiguration: async () => { loadCalls += 1; return configuration(); },
    fetchImpl: async () => { fetchCalls += 1; return new Response(); },
  });
  assert.ok(missingDb);
  assert.equal(missingDb.status, 503);
  assert.equal((await body(missingDb)).code, "dependency_database_unavailable");

  const incompatible = await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, {
    portalSchema: async () => schemaStatus("incompatible"),
    loadConfiguration: async () => { loadCalls += 1; return configuration(); },
    fetchImpl: async () => { fetchCalls += 1; return new Response(); },
  });
  assert.ok(incompatible);
  assert.equal(incompatible.status, 503);
  const incompatibleBody = await body(incompatible);
  assert.equal(incompatibleBody.state, "unready");
  assert.equal(incompatibleBody.code, "dependency_schema_unready");
  assert.equal(JSON.stringify(incompatibleBody).includes("drift-secret-sentinel"), false);
  assert.equal(loadCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("unconfigured dependencies are degraded without outbound requests", async () => {
  let fetchCalls = 0;
  const response = await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, {
    portalSchema: async () => schemaStatus(),
    loadConfiguration: async () => configuration({
      freeipa: { url: "", username: "", password: "" },
      xyops: { url: "", apiKey: "" },
    }),
    fetchImpl: async () => { fetchCalls += 1; return new Response(); },
    now: () => 1000,
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await body(response);
  assert.equal(payload.contractVersion, "1");
  assert.equal(payload.check, "dependencies");
  assert.equal(payload.state, "degraded");
  assert.equal(payload.code, "dependencies_degraded");
  assert.equal(dependency(payload, "freeipa").category, "configuration");
  assert.equal(dependency(payload, "xyops").category, "configuration");
  assert.equal(fetchCalls, 0);
});

test("all configured dependencies healthy returns sanitized versioned metadata", async () => {
  let gatewayCalls = 0;
  let xyopsCalls = 0;
  const response = await handleDependencyHealthRequest(request(), {
    DB: migrationDatabase(),
    PORTAL_BUILD_VERSION: "2026.08.04-test",
  }, {
    portalSchema: async () => schemaStatus(),
    loadConfiguration: async () => configuration(),
    now: (() => { let value = 1000; return () => value += 5; })(),
    fetchImpl: async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.endsWith("/rpc")) {
        gatewayCalls += 1;
        assert.equal(url, "http://127.0.0.1:43123/rpc");
        assert.equal(headers.get("authorization"), "Bearer gateway-token-sentinel");
        const rpcBody = JSON.parse(String(init?.body));
        assert.equal(rpcBody.method, "user_find");
        assert.deepEqual(rpcBody.options, { sizelimit: 1 });
        return new Response(JSON.stringify({ result: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      xyopsCalls += 1;
      assert.equal(url, "https://xyops.secret.example/api/app/get_events/v1");
      assert.equal(headers.get("x-api-key"), "xyops-api-key-sentinel");
      return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal(payload.state, "healthy");
  assert.equal(payload.code, "dependencies_healthy");
  assert.equal(payload.metadata.buildVersion, "2026.08.04-test");
  assert.equal(payload.metadata.schemaVersion, 3);
  assert.equal(payload.metadata.latestSchemaVersion, 3);
  assert.equal(payload.metadata.cache.source, "fresh");
  assert.equal(dependency(payload, "freeipa").state, "healthy");
  assert.equal(dependency(payload, "freeipa").category, "ok");
  assert.equal(dependency(payload, "xyops").state, "healthy");
  assert.equal(gatewayCalls, 1);
  assert.equal(xyopsCalls, 1);
  const serialized = JSON.stringify(payload);
  for (const secret of [
    "freeipa.secret.example",
    "directory-user-sentinel",
    "directory-password-sentinel",
    "xyops.secret.example",
    "xyops-api-key-sentinel",
    "gateway-token-sentinel",
  ]) assert.equal(serialized.includes(secret), false);
});

test("FreeIPA Gateway stable error codes map to safe dependency categories", async () => {
  const cases = [
    ["freeipa_dns_failed", "dns"],
    ["freeipa_tls_failed", "tls"],
    ["freeipa_timeout", "timeout"],
    ["freeipa_auth_rejected", "authentication"],
    ["freeipa_protocol_failed", "protocol"],
  ];
  for (const [gatewayCode, expectedCategory] of cases) {
    resetDependencyHealthCacheForTests();
    const response = await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, {
      portalSchema: async () => schemaStatus(),
      loadConfiguration: async () => configuration({ xyops: { url: "", apiKey: "" } }),
      fetchImpl: async () => new Response(JSON.stringify({
        code: gatewayCode,
        error: "https://private.example directory-password-sentinel",
      }), { status: 502, headers: { "content-type": "application/json" } }),
      now: () => 1000,
    });
    const payload = await body(response);
    assert.equal(payload.state, "degraded");
    assert.equal(dependency(payload, "freeipa").category, expectedCategory);
    assert.equal(JSON.stringify(payload).includes("private.example"), false);
    assert.equal(JSON.stringify(payload).includes("directory-password-sentinel"), false);
  }
});

test("XYOps status and timeout failures use bounded safe categories", async () => {
  const cases = [
    [401, "authentication"],
    [429, "rate_limited"],
    [500, "upstream"],
  ];
  for (const [status, expectedCategory] of cases) {
    resetDependencyHealthCacheForTests();
    const response = await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, {
      portalSchema: async () => schemaStatus(),
      loadConfiguration: async () => configuration({ freeipa: { url: "", username: "", password: "" } }),
      fetchImpl: async () => new Response("upstream-secret-body", { status }),
      now: () => 1000,
    });
    const payload = await body(response);
    assert.equal(dependency(payload, "xyops").category, expectedCategory);
    assert.equal(JSON.stringify(payload).includes("upstream-secret-body"), false);
  }

  resetDependencyHealthCacheForTests();
  const timeout = await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, {
    portalSchema: async () => schemaStatus(),
    loadConfiguration: async () => configuration({ freeipa: { url: "", username: "", password: "" } }),
    fetchImpl: async () => { const error = new Error("xyops-api-key-sentinel"); error.name = "TimeoutError"; throw error; },
    now: () => 1000,
  });
  const timeoutBody = await body(timeout);
  assert.equal(dependency(timeoutBody, "xyops").category, "timeout");
  assert.equal(JSON.stringify(timeoutBody).includes("xyops-api-key-sentinel"), false);
});

test("fresh results are cached and retain lastSuccessAt across a later failure", async () => {
  let now = 1000;
  let phase = "healthy";
  let fetchCalls = 0;
  const dependencies = {
    portalSchema: async () => schemaStatus(),
    loadConfiguration: async () => configuration(),
    now: () => now,
    cacheTtlMs: 30_000,
    fetchImpl: async (input) => {
      fetchCalls += 1;
      if (String(input).endsWith("/rpc") && phase === "failed") {
        return new Response(JSON.stringify({ code: "freeipa_timeout" }), { status: 502, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(String(input).endsWith("/rpc") ? { result: [] } : { events: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };

  const first = await body(await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, dependencies));
  assert.equal(first.metadata.cache.source, "fresh");
  assert.equal(dependency(first, "freeipa").lastSuccessAt, 1000);
  assert.equal(fetchCalls, 2);

  now = 2000;
  const cached = await body(await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, dependencies));
  assert.equal(cached.metadata.cache.source, "cache");
  assert.equal(cached.metadata.cache.ageMs, 1000);
  assert.equal(fetchCalls, 2);

  now = 32_000;
  phase = "failed";
  const degraded = await body(await handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, dependencies));
  assert.equal(degraded.metadata.cache.source, "fresh");
  assert.equal(dependency(degraded, "freeipa").category, "timeout");
  assert.equal(dependency(degraded, "freeipa").lastSuccessAt, 1000);
  assert.equal(dependency(degraded, "xyops").lastSuccessAt, 32_000);
  assert.equal(fetchCalls, 4);
});

test("concurrent stale requests coalesce into one probe run", async () => {
  let fetchCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const dependencies = {
    portalSchema: async () => schemaStatus(),
    loadConfiguration: async () => configuration(),
    now: () => 1000,
    fetchImpl: async (input) => {
      fetchCalls += 1;
      await gate;
      return new Response(JSON.stringify(String(input).endsWith("/rpc") ? { result: [] } : { events: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };

  const first = handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, dependencies);
  const second = handleDependencyHealthRequest(request(), { DB: migrationDatabase() }, dependencies);
  release();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal((await body(firstResponse)).state, "healthy");
  assert.equal((await body(secondResponse)).state, "healthy");
  assert.equal(fetchCalls, 2);
});
