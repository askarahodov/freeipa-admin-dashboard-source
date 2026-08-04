import assert from "node:assert/strict";
import test from "node:test";
import { handleHealthRequest } from "../worker/health-contracts.ts";

const validEncryptionKey = "11".repeat(32);
const gatewayUrl = "http://127.0.0.1:43123";
const gatewayToken = "gateway-token-sentinel";

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
    incompatibleDrift: state === "ready" ? [] : ["secret-drift-sentinel"],
    errorCode: state === "ready" ? "" : "schema_incompatible_drift",
    verifiedAt: 123,
  };
}

async function payload(response) {
  return await response.json();
}

test("liveness does not access schema, encryption or network dependencies", async () => {
  let schemaCalls = 0;
  let fetchCalls = 0;
  const response = await handleHealthRequest(
    new Request("https://portal.test/health/live"),
    {},
    {
      portalSchema: async () => { schemaCalls += 1; throw new Error("schema must not run"); },
      fetchImpl: async () => { fetchCalls += 1; throw new Error("network must not run"); },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(schemaCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(await payload(response), {
    contractVersion: "1",
    service: "freeipa-admin-dashboard",
    check: "liveness",
    state: "healthy",
    code: "health_live",
    ok: true,
    metadata: { buildVersion: "unknown", schemaVersion: null, latestSchemaVersion: null },
    checks: [],
  });
});

test("legacy health preserves its exact response and advertises its successor", async () => {
  const response = await handleHealthRequest(
    new Request("https://portal.test/api/integrations/health"),
    {},
    { portalSchema: async () => { throw new Error("not called"); }, fetchImpl: async () => { throw new Error("not called"); } },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("deprecation"), "true");
  assert.match(response.headers.get("link") ?? "", /<\/health\/live>; rel="successor-version"/);
  assert.deepEqual(await payload(response), { ok: true });
});

test("readiness rejects a missing migration-capable database before other checks", async () => {
  let schemaCalls = 0;
  let fetchCalls = 0;
  const response = await handleHealthRequest(
    new Request("https://portal.test/health/ready"),
    { CONFIG_ENCRYPTION_KEY: validEncryptionKey, IPA_NODE_GATEWAY_URL: gatewayUrl, IPA_NODE_GATEWAY_TOKEN: gatewayToken },
    {
      portalSchema: async () => { schemaCalls += 1; return schemaStatus(); },
      fetchImpl: async () => { fetchCalls += 1; return new Response("{}"); },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(schemaCalls, 0);
  assert.equal(fetchCalls, 0);
  const body = await payload(response);
  assert.equal(body.state, "unready");
  assert.equal(body.code, "health_database_unavailable");
  assert.deepEqual(body.checks, [{ name: "database", state: "unready", code: "database_unavailable" }]);
});

test("readiness reports sanitized schema metadata without drift details", async () => {
  const response = await handleHealthRequest(
    new Request("https://portal.test/health/ready"),
    { DB: migrationDatabase(), CONFIG_ENCRYPTION_KEY: validEncryptionKey, IPA_NODE_GATEWAY_URL: gatewayUrl, IPA_NODE_GATEWAY_TOKEN: gatewayToken },
    { portalSchema: async () => schemaStatus("incompatible"), fetchImpl: async () => new Response("{}") },
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  const body = await payload(response);
  assert.equal(body.code, "health_schema_unready");
  assert.equal(body.metadata.schemaVersion, 2);
  assert.equal(body.metadata.latestSchemaVersion, 3);
  assert.equal(JSON.stringify(body).includes("secret-drift-sentinel"), false);
  assert.equal(JSON.stringify(body).includes("schema_incompatible_drift"), false);
});

test("readiness fails closed when the encryption self-test cannot run", async () => {
  let fetchCalls = 0;
  const response = await handleHealthRequest(
    new Request("https://portal.test/health/ready"),
    { DB: migrationDatabase(), CONFIG_ENCRYPTION_KEY: "raw-key-sentinel", IPA_NODE_GATEWAY_URL: gatewayUrl, IPA_NODE_GATEWAY_TOKEN: gatewayToken },
    {
      portalSchema: async () => schemaStatus(),
      fetchImpl: async () => { fetchCalls += 1; return new Response("{}"); },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(fetchCalls, 0);
  const body = await payload(response);
  assert.equal(body.code, "health_encryption_unavailable");
  assert.equal(JSON.stringify(body).includes("raw-key-sentinel"), false);
});

test("readiness sanitizes Gateway failures and never contacts FreeIPA", async () => {
  const upstreamSentinel = "https://freeipa.secret.example/ipa/session/json";
  const response = await handleHealthRequest(
    new Request("https://portal.test/health/ready"),
    { DB: migrationDatabase(), CONFIG_ENCRYPTION_KEY: validEncryptionKey, IPA_NODE_GATEWAY_URL: gatewayUrl, IPA_NODE_GATEWAY_TOKEN: gatewayToken },
    {
      portalSchema: async () => schemaStatus(),
      fetchImpl: async (input, init) => {
        assert.equal(String(input), `${gatewayUrl}/health`);
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${gatewayToken}`);
        throw new Error(`${upstreamSentinel} ${gatewayToken}`);
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  const body = await payload(response);
  assert.equal(body.code, "health_gateway_unavailable");
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(upstreamSentinel), false);
  assert.equal(serialized.includes(gatewayToken), false);
  assert.equal(serialized.includes(gatewayUrl), false);
});

test("readiness is healthy only after database, schema, encryption and Gateway checks pass", async () => {
  const response = await handleHealthRequest(
    new Request("https://portal.test/health/ready"),
    {
      DB: migrationDatabase(),
      CONFIG_ENCRYPTION_KEY: validEncryptionKey,
      IPA_NODE_GATEWAY_URL: gatewayUrl,
      IPA_NODE_GATEWAY_TOKEN: gatewayToken,
      PORTAL_BUILD_VERSION: "2026.08.04-test",
    },
    {
      portalSchema: async () => schemaStatus(),
      fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await payload(response);
  assert.equal(body.ok, true);
  assert.equal(body.state, "healthy");
  assert.equal(body.code, "health_ready");
  assert.deepEqual(body.metadata, { buildVersion: "2026.08.04-test", schemaVersion: 3, latestSchemaVersion: 3 });
  assert.deepEqual(body.checks.map((item) => [item.name, item.state, item.code]), [
    ["database", "healthy", "database_available"],
    ["schema", "healthy", "schema_ready"],
    ["encryption", "healthy", "encryption_ready"],
    ["gateway", "healthy", "gateway_ready"],
  ]);
});

test("non-health routes are not intercepted", async () => {
  const response = await handleHealthRequest(
    new Request("https://portal.test/api/auth/session"),
    {},
    { portalSchema: async () => schemaStatus(), fetchImpl: fetch },
  );
  assert.equal(response, null);
});
