import assert from "node:assert/strict";
import test from "node:test";

import {
  MAINTENANCE_CANCEL_PATH,
  MAINTENANCE_COMPLETE_PATH,
  MAINTENANCE_ENTER_PATH,
  MAINTENANCE_EXIT_PATH,
  MAINTENANCE_PREPARE_PATH,
  MAINTENANCE_STATUS_PATH,
  MAINTENANCE_VERIFICATION_START_PATH,
  handleMaintenanceControlRequest,
} from "../worker/maintenance-control-entry.ts";

const operationId = "maintenance_11111111-1111-4111-8111-111111111111";
const controllerSecret = "A".repeat(43);
const hash = "1".repeat(64);
const context = {
  correlationId: "cor_11111111111111111111",
  actor: { identity: "admin@example.test", role: "admin", groups: ["portal-admins"] },
};
const verification = {
  integrity: "ok",
  schema: "ok",
  administratorAccess: "ok",
  settingsDecryption: "ok",
  auditWrite: "ok",
};
const rows = {
  inactive: {
    id: "main", state: "inactive", operationId: null, actorIdentity: null, actorGroups: [],
    controllerSecretHash: null, createdAt: null, updatedAt: 500, expiresAt: null,
    completedAt: null, failureCode: null, verification: {},
  },
  entering: {
    id: "main", state: "entering", operationId, actorIdentity: context.actor.identity,
    actorGroups: context.actor.groups, controllerSecretHash: hash, createdAt: 1000,
    updatedAt: 1000, expiresAt: 901000, completedAt: null, failureCode: null, verification: {},
  },
  active: {
    id: "main", state: "active", operationId, actorIdentity: context.actor.identity,
    actorGroups: context.actor.groups, controllerSecretHash: hash, createdAt: 1000,
    updatedAt: 2000, expiresAt: null, completedAt: null, failureCode: null, verification: {},
  },
  verifying: {
    id: "main", state: "verifying", operationId, actorIdentity: context.actor.identity,
    actorGroups: context.actor.groups, controllerSecretHash: hash, createdAt: 1000,
    updatedAt: 3000, expiresAt: null, completedAt: null, failureCode: null, verification: {},
  },
  exiting: {
    id: "main", state: "exiting", operationId, actorIdentity: context.actor.identity,
    actorGroups: context.actor.groups, controllerSecretHash: hash, createdAt: 1000,
    updatedAt: 4000, expiresAt: null, completedAt: null, failureCode: null, verification,
  },
};

function request(path, body, options = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "https://portal.example",
    ...(options.headers ?? {}),
  });
  if (options.noOrigin) headers.delete("origin");
  return new Request(`https://portal.example${path}`, {
    method: options.method ?? (path === MAINTENANCE_STATUS_PATH ? "GET" : "POST"),
    headers,
    body: (options.method ?? (path === MAINTENANCE_STATUS_PATH ? "GET" : "POST")) === "GET"
      ? undefined
      : typeof body === "string" ? body : JSON.stringify(body ?? {}),
  });
}

function transitionBody(prefix, extra = {}) {
  return {
    operationId,
    controllerSecret,
    confirmation: `${prefix}:${operationId}`,
    ...extra,
  };
}

function fixture(overrides = {}) {
  const calls = [];
  const audit = [];
  const dependencies = {
    async loadState() { calls.push("load"); return rows.active; },
    async prepare(db, actor) {
      calls.push("prepare");
      assert.deepEqual(actor, { identity: context.actor.identity, groups: context.actor.groups });
      return { row: rows.entering, secret: controllerSecret };
    },
    async enter(db, input) { calls.push("enter"); assert.equal(input.controllerSecret, controllerSecret); return rows.active; },
    async startVerification(db, input) { calls.push("verify"); assert.equal(input.confirmation, `VERIFY:${operationId}`); return rows.verifying; },
    async exit(db, input) { calls.push("exit"); assert.deepEqual(input.verification, verification); return rows.exiting; },
    async complete(db, input) { calls.push("complete"); assert.equal(input.confirmation, `RESUME:${operationId}`); return { ...rows.inactive, completedAt: 5000, updatedAt: 5000 }; },
    async cancel(db, input) { calls.push("cancel"); assert.equal(input.confirmation, `CANCEL:${operationId}`); return { ...rows.inactive, completedAt: 2000, updatedAt: 2000 }; },
    async appendAudit(env, receivedContext, event) {
      calls.push("audit");
      assert.equal(receivedContext, context);
      audit.push(event);
      return null;
    },
    ...overrides,
  };
  return { calls, audit, dependencies };
}

test("returns administrator-safe no-store status without controller or actor material", async () => {
  const f = fixture();
  const response = await handleMaintenanceControlRequest(
    request(MAINTENANCE_STATUS_PATH), { DB: {} }, context, f.dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.state, "active");
  assert.equal(payload.operationId, operationId);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [controllerSecret, hash, context.actor.identity, "portal-admins"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(f.calls, ["load"]);
});

test("prepare returns the controller secret exactly once and audits only aggregate state", async () => {
  const f = fixture();
  const response = await handleMaintenanceControlRequest(
    request(MAINTENANCE_PREPARE_PATH, {}), { DB: {} }, context, f.dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    prepared: true,
    state: "entering",
    operationId,
    controllerSecret,
    expiresAt: 901000,
    confirmation: `ENTER:${operationId}`,
  });
  assert.deepEqual(f.calls, ["prepare", "audit"]);
  assert.equal(f.audit[0].action, "maintenance.prepare");
  assert.equal(f.audit[0].resourceId, operationId);
  assert.equal(f.audit[0].outcome, "pending");
  const serializedAudit = JSON.stringify(f.audit);
  assert.equal(serializedAudit.includes(controllerSecret), false);
  assert.equal(serializedAudit.includes(hash), false);
});

test("dispatches every exact transition shape and writes aggregate audit", async () => {
  const cases = [
    [MAINTENANCE_ENTER_PATH, transitionBody("ENTER"), "enter", "active", "maintenance.enter"],
    [MAINTENANCE_VERIFICATION_START_PATH, transitionBody("VERIFY"), "verify", "verifying", "maintenance.verification.start"],
    [MAINTENANCE_EXIT_PATH, transitionBody("EXIT", { verification }), "exit", "exiting", "maintenance.exit"],
    [MAINTENANCE_COMPLETE_PATH, transitionBody("RESUME"), "complete", "inactive", "maintenance.complete"],
    [MAINTENANCE_CANCEL_PATH, transitionBody("CANCEL"), "cancel", "inactive", "maintenance.cancel"],
  ];
  for (const [path, body, call, state, action] of cases) {
    const f = fixture();
    const response = await handleMaintenanceControlRequest(request(path, body), { DB: {} }, context, f.dependencies);
    assert.equal(response.status, 200, path);
    assert.equal((await response.json()).state, state);
    assert.deepEqual(f.calls, [call, "audit"]);
    assert.equal(f.audit[0].action, action);
    assert.equal(f.audit[0].resourceId, operationId);
    const serialized = JSON.stringify(f.audit);
    assert.equal(serialized.includes(controllerSecret), false);
    assert.equal(serialized.includes(hash), false);
    assert.equal(serialized.includes(`ENTER:${operationId}`), false);
  }
});

test("same-origin method and shape checks run before body-dependent repository work", async () => {
  const cases = [
    [request(MAINTENANCE_PREPARE_PATH, {}, { noOrigin: true }), 403, "maintenance_origin_forbidden"],
    [request(MAINTENANCE_ENTER_PATH, transitionBody("ENTER"), { method: "GET" }), 405, "maintenance_method_not_allowed"],
    [request(MAINTENANCE_EXIT_PATH, { ...transitionBody("EXIT", { verification }), extra: true }), 400, "maintenance_request_invalid"],
    [request(MAINTENANCE_PREPARE_PATH, "{}", { headers: { "content-length": String(17 * 1024) } }), 413, "maintenance_request_too_large"],
  ];
  for (const [req, expectedStatus, code] of cases) {
    const f = fixture();
    const response = await handleMaintenanceControlRequest(req, { DB: {} }, context, f.dependencies);
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).code, code);
    assert.equal(f.calls.some((call) => ["prepare", "enter", "exit", "load"].includes(call)), false);
  }
});

test("normalizes repository failures and never returns raw request material", async () => {
  const f = fixture({
    async enter() {
      f.calls.push("enter");
      throw Object.assign(new Error(`raw ${controllerSecret} D1 detail`), {
        code: "maintenance_controller_invalid",
        status: 409,
      });
    },
  });
  const response = await handleMaintenanceControlRequest(
    request(MAINTENANCE_ENTER_PATH, transitionBody("ENTER")), { DB: {} }, context, f.dependencies,
  );
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.code, "maintenance_controller_invalid");
  assert.equal(JSON.stringify(payload).includes(controllerSecret), false);
  assert.equal(f.audit.at(-1).outcome, "failure");
  assert.equal(JSON.stringify(f.audit).includes(controllerSecret), false);
});
