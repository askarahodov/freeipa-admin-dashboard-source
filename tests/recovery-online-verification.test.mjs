import assert from "node:assert/strict";
import test from "node:test";

import { verifyPortalRecoveryOnline } from "../recovery-online-verification.ts";

const operationId = "maintenance_11111111-1111-4111-8111-111111111111";
const controllerSecret = "A".repeat(43);

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

test("runs bounded smoke transitions and final login audit verification", async () => {
  const calls = [];
  const responses = [
    jsonResponse({ ok: true }),
    jsonResponse({ state: "ready", currentVersion: 3 }),
    jsonResponse({ state: "active", operationId }),
    jsonResponse({ operationId, checks: { administratorAccess: "ok", settingsDecryption: "ok", auditWrite: "ok", sessionsRevoked: "ok" } }),
    jsonResponse({ state: "verifying", operationId }),
    jsonResponse({ state: "exiting", operationId }),
    jsonResponse({ state: "inactive" }),
    jsonResponse({ state: "inactive" }),
    jsonResponse({ authenticated: true }, 200, { "set-cookie": "portal_session=token; Path=/; HttpOnly" }),
    jsonResponse({ events: [{ action: "portal.full_restore.verification_smoke", resourceId: operationId }] }),
    jsonResponse({ ok: true }),
  ];
  const result = await verifyPortalRecoveryOnline({
    baseUrl: "http://127.0.0.1:3001",
    serviceToken: "service-token",
    operationId,
    controllerSecret,
    administratorUsername: "admin",
    administratorPassword: "correct horse battery staple",
  }, {
    async fetch(input, init) {
      calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body });
      const response = responses.shift();
      if (!response) throw new Error("unexpected request");
      return response;
    },
  });

  assert.deepEqual(result, {
    operationId,
    state: "inactive",
    checks: {
      health: "ok",
      schema: "ok",
      administratorAccess: "ok",
      settingsDecryption: "ok",
      auditWrite: "ok",
      sessionsRevoked: "ok",
      login: "ok",
      logout: "ok",
      finalAudit: "ok",
    },
  });
  assert.deepEqual(calls.map((call) => [new URL(call.url).pathname, call.method]), [
    ["/api/integrations/health", "GET"],
    ["/api/schema/status", "GET"],
    ["/api/admin/maintenance/status", "GET"],
    ["/api/admin/maintenance/verification/smoke", "POST"],
    ["/api/admin/maintenance/verification/start", "POST"],
    ["/api/admin/maintenance/exit", "POST"],
    ["/api/admin/maintenance/complete", "POST"],
    ["/api/admin/maintenance/status", "GET"],
    ["/api/auth/login", "POST"],
    ["/api/integrations/audit", "GET"],
    ["/api/auth/logout", "POST"],
  ]);
  for (const call of calls.slice(0, 8)) {
    assert.equal(call.headers.get("x-admin-token"), "service-token");
    if (call.method === "POST") assert.equal(call.headers.get("origin"), "http://127.0.0.1:3001");
  }
  assert.match(String(calls[8].body), /correct horse battery staple/u);
  assert.equal(calls[9].headers.get("cookie"), "portal_session=token");
  assert.equal(calls[10].headers.get("cookie"), "portal_session=token");
  assert.equal(responses.length, 0);
});

test("starts from verifying without repeating the verification transition", async () => {
  const paths = [];
  const responses = [
    jsonResponse({ ok: true }),
    jsonResponse({ state: "ready", currentVersion: 3 }),
    jsonResponse({ state: "verifying", operationId }),
    jsonResponse({ operationId, checks: { administratorAccess: "ok", settingsDecryption: "ok", auditWrite: "ok", sessionsRevoked: "ok" } }),
    jsonResponse({ state: "exiting", operationId }),
    jsonResponse({ state: "inactive" }),
    jsonResponse({ state: "inactive" }),
    jsonResponse({ authenticated: true }, 200, { "set-cookie": "portal_session=token; Path=/" }),
    jsonResponse({ events: [{ action: "portal.full_restore.verification_smoke", resourceId: operationId }] }),
    jsonResponse({ ok: true }),
  ];
  await verifyPortalRecoveryOnline({
    baseUrl: "http://localhost:3001",
    serviceToken: "service-token",
    operationId,
    controllerSecret,
    administratorUsername: "admin",
    administratorPassword: "password",
  }, {
    async fetch(input) {
      paths.push(new URL(String(input)).pathname);
      return responses.shift();
    },
  });
  assert.equal(paths.includes("/api/admin/maintenance/verification/start"), false);
});

test("fails closed before complete on mismatched operation or unsafe response", async () => {
  const cases = [
    [jsonResponse({ state: "active", operationId: "maintenance_22222222-2222-4222-8222-222222222222" }), "recovery_online_operation_mismatch"],
    [new Response("x".repeat(70_000), { status: 200 }), "recovery_online_response_invalid"],
  ];
  for (const [statusResponse, code] of cases) {
    const responses = [
      jsonResponse({ ok: true }),
      jsonResponse({ state: "ready", currentVersion: 3 }),
      statusResponse,
    ];
    await assert.rejects(
      verifyPortalRecoveryOnline({
        baseUrl: "http://localhost:3001",
        serviceToken: "service-token",
        operationId,
        controllerSecret,
        administratorUsername: "admin",
        administratorPassword: "password",
      }, { async fetch() { return responses.shift(); } }),
      (error) => error.code === code,
    );
  }
});

test("does not expose credentials or upstream bodies in failures", async () => {
  await assert.rejects(
    verifyPortalRecoveryOnline({
      baseUrl: "http://localhost:3001",
      serviceToken: "secret-service-token",
      operationId,
      controllerSecret,
      administratorUsername: "admin",
      administratorPassword: "secret-password",
    }, {
      async fetch() {
        return jsonResponse({ error: "raw secret-password secret-service-token" }, 500);
      },
    }),
    (error) => error.code === "recovery_online_request_failed"
      && !/secret-password|secret-service-token/u.test(error.message),
  );
});
