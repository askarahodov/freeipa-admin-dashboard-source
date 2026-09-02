import assert from "node:assert/strict";
import test from "node:test";

import { handleStorageMigrationApplyRequest } from "../worker/storage-migration-apply-entry.ts";
import {
  STORAGE_MIGRATION_APPLY_PATH,
  STORAGE_MIGRATION_APPLY_STATUS_PATH,
  STORAGE_MIGRATION_RECONCILE_PATH,
} from "../src/storage/migration/apply/storage-migration-apply-contract.ts";

const maintenanceOperationId = "maintenance_00000000-0000-4000-8000-000000000000";
const controllerSecret = "a".repeat(43);
const input = {
  maintenanceOperationId,
  controllerSecret,
  confirmation: `APPLY:${maintenanceOperationId}:4:5`,
};

function operation(state = "succeeded") {
  return {
    contractVersion: "1",
    state,
    operationId: state === "idle" ? null : "migration_00000000-0000-4000-8000-000000000000",
    fromVersion: state === "idle" ? 0 : 4,
    currentVersion: state === "idle" ? 0 : 5,
    targetVersion: state === "idle" ? 0 : 5,
    totalCount: state === "idle" ? 0 : 1,
    appliedCount: state === "idle" ? 0 : 1,
    createdAt: state === "idle" ? null : 100,
    startedAt: state === "idle" ? null : 100,
    updatedAt: state === "idle" ? null : 110,
    completedAt: state === "idle" ? null : 110,
    failureCode: null,
    recoveryRequired: false,
    correlationId: "cor_apply123456789012345",
  };
}

function deps(overrides = {}) {
  return {
    authorize: async () => ({ role: "admin", identity: "admin@example.test", groups: ["admins"] }),
    createContext: () => ({
      correlationId: "cor_apply123456789012345",
      actor: { identity: "admin@example.test", role: "admin", groups: ["admins"] },
    }),
    apply: async () => operation("succeeded"),
    status: async () => operation("idle"),
    reconcile: async () => operation("reconciled"),
    ...overrides,
  };
}

function request(path, method = "POST", body = input, headers = {}) {
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (method !== "GET" && method !== "HEAD") init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://portal.example${path}`, init);
}

test("apply handler ignores unrelated paths and enforces exact methods", async () => {
  assert.equal(await handleStorageMigrationApplyRequest(request("/api/other"), {}, deps()), null);
  const applyGet = await handleStorageMigrationApplyRequest(request(STORAGE_MIGRATION_APPLY_PATH, "GET"), {}, deps());
  assert.equal(applyGet.status, 405);
  assert.equal(applyGet.headers.get("allow"), "POST");
  const statusPost = await handleStorageMigrationApplyRequest(request(STORAGE_MIGRATION_APPLY_STATUS_PATH, "POST"), {}, deps());
  assert.equal(statusPost.status, 405);
  assert.equal(statusPost.headers.get("allow"), "GET");
});

test("non-admin access is denied before body, context, engine and D1", async () => {
  for (const role of ["viewer", "operator"]) {
    const calls = [];
    const env = { DB: new Proxy({}, { get() { calls.push("db"); throw new Error("db"); } }) };
    const response = await handleStorageMigrationApplyRequest(
      request(STORAGE_MIGRATION_APPLY_PATH, "POST", "{"),
      env,
      deps({
        authorize: async () => ({ role, identity: `${role}@example.test`, groups: [] }),
        createContext: () => { calls.push("context"); throw new Error("context"); },
        apply: async () => { calls.push("apply"); throw new Error("apply"); },
      }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(calls, []);
  }
});

test("POST body is bounded to 4 KiB, streamed and requires exact fields", async () => {
  for (const [body, status] of [
    ["{", 400],
    ["null", 400],
    ["[]", 400],
    [{ maintenanceOperationId, controllerSecret }, 400],
    [{ ...input, targetVersion: 5 }, 400],
    [{ ...input, controllerSecret: "x".repeat(4200) }, 413],
  ]) {
    const response = await handleStorageMigrationApplyRequest(request(STORAGE_MIGRATION_APPLY_PATH, "POST", body), {}, deps());
    assert.equal(response.status, status);
  }
  const declared = await handleStorageMigrationApplyRequest(
    request(STORAGE_MIGRATION_APPLY_PATH, "POST", input, { "content-length": "4097" }),
    {},
    deps(),
  );
  assert.equal(declared.status, 413);
});

test("status, apply and reconcile return no-store safe results with correlation", async () => {
  for (const [path, method, expectedState] of [
    [STORAGE_MIGRATION_APPLY_STATUS_PATH, "GET", "idle"],
    [STORAGE_MIGRATION_APPLY_PATH, "POST", "succeeded"],
    [STORAGE_MIGRATION_RECONCILE_PATH, "POST", "reconciled"],
  ]) {
    const body = path === STORAGE_MIGRATION_RECONCILE_PATH
      ? { ...input, confirmation: `RECONCILE:${maintenanceOperationId}` }
      : input;
    const response = await handleStorageMigrationApplyRequest(request(path, method, body), {}, deps());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-correlation-id"), "cor_apply123456789012345");
    const payload = await response.json();
    assert.equal(payload.state, expectedState);
    assert.equal(JSON.stringify(payload).includes(controllerSecret), false);
    assert.equal(JSON.stringify(payload).includes(maintenanceOperationId), false);
  }
});

test("known engine errors preserve fixed status and unknown failures are sanitized", async () => {
  const known = await handleStorageMigrationApplyRequest(request(STORAGE_MIGRATION_APPLY_PATH), {}, deps({
    apply: async () => { throw Object.assign(new Error("raw path /var/lib/db"), { code: "migration_apply_busy", status: 409 }); },
  }));
  assert.equal(known.status, 409);
  assert.deepEqual(await known.json(), { ok: false, code: "migration_apply_busy", correlationId: "cor_apply123456789012345" });

  const unknown = await handleStorageMigrationApplyRequest(request(STORAGE_MIGRATION_APPLY_PATH), {}, deps({
    apply: async () => { throw new Error("controllerSecret=/tmp/private.sqlite"); },
  }));
  assert.equal(unknown.status, 503);
  const payload = await unknown.json();
  assert.deepEqual(payload, { ok: false, code: "migration_apply_unavailable", correlationId: "cor_apply123456789012345" });
  assert.equal(JSON.stringify(payload).includes("private.sqlite"), false);
});
