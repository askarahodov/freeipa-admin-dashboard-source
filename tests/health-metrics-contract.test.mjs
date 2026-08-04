import assert from "node:assert/strict";
import test from "node:test";
import { handleHealthMetricsRequest } from "../worker/health-metrics.ts";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function healthyPayload(path) {
  if (path === "/health/live") {
    return {
      contractVersion: "1",
      service: "freeipa-admin-dashboard",
      check: "liveness",
      state: "healthy",
      code: "health_live",
      ok: true,
      metadata: { buildVersion: "2026.08.04-test", schemaVersion: null, latestSchemaVersion: null },
      checks: [],
    };
  }
  return {
    contractVersion: "1",
    service: "freeipa-admin-dashboard",
    check: "readiness",
    state: "healthy",
    code: "health_ready",
    ok: true,
    metadata: { buildVersion: "2026.08.04-test", schemaVersion: 3, latestSchemaVersion: 3 },
    checks: [
      { name: "database", state: "healthy", code: "database_available" },
      { name: "schema", state: "healthy", code: "schema_ready" },
      { name: "encryption", state: "healthy", code: "encryption_ready" },
      { name: "gateway", state: "healthy", code: "gateway_ready" },
    ],
  };
}

async function metrics(response) {
  assert.ok(response);
  return await response.text();
}

test("healthy metrics are deterministic and use only bounded labels", async () => {
  const requestedPaths = [];
  const response = await handleHealthMetricsRequest(
    new Request("https://portal.test/metrics/health"),
    {},
    {
      healthHandler: async (request) => {
        const path = new URL(request.url).pathname;
        requestedPaths.push(path);
        return json(healthyPayload(path));
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain; version=0\.0\.4/);
  assert.deepEqual(requestedPaths, ["/health/live", "/health/ready"]);

  const text = await metrics(response);
  assert.match(text, /portal_health_contract_info\{version="1"\} 1/);
  assert.match(text, /portal_build_info\{version="2026\.08\.04-test"\} 1/);
  assert.match(text, /portal_health_live 1/);
  assert.match(text, /portal_health_ready 1/);
  for (const check of ["database", "schema", "encryption", "gateway"]) {
    assert.match(text, new RegExp(`portal_health_readiness_check\\{check="${check}"\\} 1`));
  }
  assert.match(text, /portal_health_schema_version 3/);
  assert.match(text, /portal_health_schema_latest_version 3/);
  assert.match(text, /portal_health_schema_lag 0/);
  assert.match(text, /portal_health_dependency_contract_info\{mode="cached_json",path="\/health\/dependencies"\} 1/);
  assert.equal(text.includes("health_ready"), false);
  assert.equal(text.includes("database_available"), false);
  assert.equal(text.includes("freeipa"), false);
  assert.equal(text.includes("xyops"), false);
});

test("unready metrics expose fixed zero gauges without raw failure details", async () => {
  const secret = "https://internal.example api-key-sentinel raw-error-sentinel";
  const response = await handleHealthMetricsRequest(
    new Request("https://portal.test/metrics/health"),
    { PORTAL_BUILD_VERSION: secret },
    {
      healthHandler: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/health/live") return json(healthyPayload(path));
        return json({
          contractVersion: "1",
          check: "readiness",
          state: "unready",
          code: `health_schema_unready ${secret}`,
          ok: false,
          metadata: {
            buildVersion: secret,
            schemaVersion: 2,
            latestSchemaVersion: 3,
          },
          checks: [
            { name: "database", state: "healthy", code: "database_available" },
            { name: "schema", state: "unready", code: `schema_unavailable ${secret}` },
          ],
        }, 503);
      },
    },
  );

  const text = await metrics(response);
  assert.match(text, /portal_build_info\{version="unknown"\} 1/);
  assert.match(text, /portal_health_live 1/);
  assert.match(text, /portal_health_ready 0/);
  assert.match(text, /portal_health_readiness_check\{check="database"\} 1/);
  assert.match(text, /portal_health_readiness_check\{check="schema"\} 0/);
  assert.match(text, /portal_health_readiness_check\{check="encryption"\} 0/);
  assert.match(text, /portal_health_readiness_check\{check="gateway"\} 0/);
  assert.match(text, /portal_health_schema_version 2/);
  assert.match(text, /portal_health_schema_latest_version 3/);
  assert.match(text, /portal_health_schema_lag 1/);
  for (const value of ["internal.example", "api-key-sentinel", "raw-error-sentinel", "health_schema_unready", "schema_unavailable"]) {
    assert.equal(text.includes(value), false);
  }
});

test("metrics remain scrapeable when local health evaluation throws", async () => {
  let calls = 0;
  const response = await handleHealthMetricsRequest(
    new Request("https://portal.test/metrics/health"),
    { PORTAL_BUILD_VERSION: "build-42" },
    {
      healthHandler: async () => {
        calls += 1;
        throw new Error("database-password-sentinel");
      },
    },
  );

  assert.equal(calls, 2);
  assert.ok(response);
  assert.equal(response.status, 200);
  const text = await metrics(response);
  assert.match(text, /portal_build_info\{version="build-42"\} 1/);
  assert.match(text, /portal_health_live 0/);
  assert.match(text, /portal_health_ready 0/);
  assert.match(text, /portal_health_schema_version -1/);
  assert.match(text, /portal_health_schema_latest_version -1/);
  assert.match(text, /portal_health_schema_lag -1/);
  assert.equal(text.includes("database-password-sentinel"), false);
});

test("metrics never request dependency health", async () => {
  const requestedPaths = [];
  const response = await handleHealthMetricsRequest(
    new Request("https://portal.test/metrics/health"),
    {},
    {
      healthHandler: async (request) => {
        const path = new URL(request.url).pathname;
        requestedPaths.push(path);
        if (path === "/health/dependencies") throw new Error("external probe forbidden");
        return json(healthyPayload(path));
      },
    },
  );
  assert.equal(response?.status, 200);
  assert.deepEqual(requestedPaths, ["/health/live", "/health/ready"]);
});

test("metrics handler ignores unrelated routes and rejects mutations", async () => {
  assert.equal(
    await handleHealthMetricsRequest(
      new Request("https://portal.test/health/live"),
      {},
      { healthHandler: async () => json({}) },
    ),
    null,
  );

  let calls = 0;
  const response = await handleHealthMetricsRequest(
    new Request("https://portal.test/metrics/health", { method: "POST" }),
    {},
    { healthHandler: async () => { calls += 1; return json({}); } },
  );
  assert.ok(response);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), { ok: false, code: "health_metrics_method_not_allowed" });
});
