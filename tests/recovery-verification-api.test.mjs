import assert from "node:assert/strict";
import test from "node:test";

import {
  MAINTENANCE_VERIFICATION_SMOKE_PATH,
  handleMaintenanceVerificationSmokeRequest,
} from "../worker/maintenance-verification-smoke-entry.ts";
import { handleMaintenanceControlRoute } from "../worker/maintenance-control-dispatch.ts";
import { runMaintenanceVerificationSmoke } from "../maintenance-verification-smoke.ts";

const operationId = "maintenance_11111111-1111-4111-8111-111111111111";
const controllerSecret = "A".repeat(43);
const controllerHash = "1".repeat(64);
const context = {
  correlationId: "cor_11111111111111111111",
  actor: { identity: "service-admin@portal.local", role: "admin", groups: [] },
};

function request(body, options = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "https://portal.example",
    ...(options.headers ?? {}),
  });
  if (options.noOrigin) headers.delete("origin");
  return new Request(`https://portal.example${MAINTENANCE_VERIFICATION_SMOKE_PATH}`, {
    method: options.method ?? "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function body(overrides = {}) {
  return {
    operationId,
    controllerSecret,
    administratorUsername: "admin",
    administratorPassword: "correct horse battery staple",
    ...overrides,
  };
}

function row(state = "active") {
  return {
    id: "main",
    state,
    operationId,
    actorIdentity: "admin@local.portal",
    actorGroups: [],
    controllerSecretHash: controllerHash,
    createdAt: 1000,
    updatedAt: 2000,
    expiresAt: null,
    completedAt: null,
    failureCode: null,
    verification: {},
  };
}

test("verification smoke validates controller admin settings audit and zero sessions", async () => {
  const calls = [];
  const result = await runMaintenanceVerificationSmoke({
    db: { prepare() {}, batch() {} },
    configEncryptionKey: "2".repeat(64),
    operationId,
    controllerSecret,
    administratorUsername: "admin",
    administratorPassword: "correct horse battery staple",
    auditContext: context,
    now: 5000,
  }, {
    async loadState() { calls.push("state"); return row("active"); },
    async verifyController(hash, secret) {
      calls.push("controller");
      assert.equal(hash, controllerHash);
      assert.equal(secret, controllerSecret);
      return true;
    },
    async verifyAdministrator(_db, username, password, now) {
      calls.push("administrator");
      assert.equal(username, "admin");
      assert.equal(password, "correct horse battery staple");
      assert.equal(now, 5000);
      return { id: "user-1" };
    },
    async verifySettings(_db, key) {
      calls.push("settings");
      assert.equal(key, "2".repeat(64));
      return { settingsDecryption: "ok" };
    },
    async auditSmoke(_db, receivedContext, receivedOperationId, now) {
      calls.push("audit");
      assert.equal(receivedContext, context);
      assert.equal(receivedOperationId, operationId);
      assert.equal(now, 5000);
      return { auditWrite: "ok", sessionsRevoked: "ok" };
    },
  });
  assert.deepEqual(result, {
    operationId,
    checks: {
      administratorAccess: "ok",
      settingsDecryption: "ok",
      auditWrite: "ok",
      sessionsRevoked: "ok",
    },
  });
  assert.deepEqual(calls, ["state", "controller", "administrator", "settings", "audit"]);
});

test("verification smoke rejects wrong state operation and controller before credential work", async () => {
  for (const [state, rowOperation, controllerOk] of [
    ["inactive", operationId, true],
    ["active", "maintenance_22222222-2222-4222-8222-222222222222", true],
    ["verifying", operationId, false],
  ]) {
    let credentialWork = false;
    await assert.rejects(
      runMaintenanceVerificationSmoke({
        db: { prepare() {}, batch() {} }, configEncryptionKey: "2".repeat(64), operationId, controllerSecret,
        administratorUsername: "admin", administratorPassword: "password", auditContext: context,
      }, {
        async loadState() { return { ...row(state), operationId: rowOperation }; },
        async verifyController() { return controllerOk; },
        async verifyAdministrator() { credentialWork = true; return { id: "user" }; },
        async verifySettings() { throw new Error("unreachable"); },
        async auditSmoke() { throw new Error("unreachable"); },
      }),
      (error) => ["maintenance_transition_invalid", "maintenance_controller_invalid"].includes(error.code),
    );
    assert.equal(credentialWork, false);
  }
});

test("api returns aggregate no-store smoke result", async () => {
  const calls = [];
  const response = await handleMaintenanceVerificationSmokeRequest(
    request(body()),
    { DB: { prepare() {}, batch() {} }, CONFIG_ENCRYPTION_KEY: "2".repeat(64) },
    context,
    {
      async smoke() {
        calls.push("smoke");
        return {
          operationId,
          checks: {
            administratorAccess: "ok",
            settingsDecryption: "ok",
            auditWrite: "ok",
            sessionsRevoked: "ok",
          },
        };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    operationId,
    checks: {
      administratorAccess: "ok",
      settingsDecryption: "ok",
      auditWrite: "ok",
      sessionsRevoked: "ok",
    },
  });
  assert.deepEqual(calls, ["smoke"]);
});

test("api enforces same-origin exact body and bounded credentials", async () => {
  const cases = [
    [request(body(), { noOrigin: true }), 403, "maintenance_origin_forbidden"],
    [request({ ...body(), extra: true }), 400, "maintenance_request_invalid"],
    [request(body({ administratorUsername: "a".repeat(65) })), 400, "maintenance_request_invalid"],
    [request(body({ administratorPassword: "x".repeat(257) })), 400, "maintenance_request_invalid"],
    [request(body(), { method: "GET" }), 405, "maintenance_method_not_allowed"],
  ];
  for (const [req, status, code] of cases) {
    let called = false;
    const response = await handleMaintenanceVerificationSmokeRequest(req, { DB: { prepare() {}, batch() {} } }, context, {
      async smoke() { called = true; throw new Error("unreachable"); },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.equal(called, false);
  }
});

test("dispatch permits verification smoke only through trusted service-admin marker", async () => {
  for (const [trusted, expected] of [[false, 403], [true, 200]]) {
    let handled = false;
    const response = await handleMaintenanceControlRoute(request(body()), {
      DB: {},
      PORTAL_SERVICE_ADMIN_AUTHORIZED: trusted ? "1" : undefined,
      PORTAL_IDENTITY_MODE: "static",
      PORTAL_STATIC_IDENTITY: "service-admin@portal.local",
      PORTAL_DEFAULT_ROLE: "admin",
    }, {
      createContext() { return context; },
      async smokeHandler() {
        handled = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    assert.equal(response.status, expected);
    assert.equal(handled, trusted);
  }
});
