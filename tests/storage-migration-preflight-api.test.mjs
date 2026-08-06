import assert from "node:assert/strict";
import test from "node:test";

import { handleStorageMigrationPreflightRequest } from "../worker/storage-migration-preflight-entry.ts";

const path = "/api/admin/storage/migrations/preflight";

function report(state = "ready") {
  const unavailable = state === "unavailable";
  const notRequired = state === "not_required";
  const blocked = state === "blocked";
  return {
    contractVersion: "1",
    generatedAt: 1000,
    durationMs: 5,
    state,
    decision: state === "ready" ? "allow" : "deny",
    code: state === "ready"
      ? "migration_preflight_ready"
      : notRequired
        ? "migration_preflight_not_required"
        : blocked
          ? "migration_backup_missing"
          : "migration_preflight_unavailable",
    pendingMigrationCount: notRequired || unavailable ? 0 : 1,
    schema: {
      state: unavailable ? "unavailable" : "ready",
      currentVersion: unavailable ? null : 3,
      latestVersion: unavailable ? null : 4,
      code: unavailable ? "migration_schema_unavailable" : "migration_schema_ready",
    },
    journal: {
      state: unavailable ? "unavailable" : "valid",
      appliedCount: unavailable ? 0 : 3,
      pendingCount: notRequired || unavailable ? 0 : 1,
      code: unavailable ? "migration_journal_unavailable" : "migration_journal_valid",
    },
    integrity: {
      state: notRequired ? "not_required" : unavailable ? "unavailable" : "healthy",
      code: notRequired
        ? "migration_quick_check_not_required"
        : unavailable
          ? "migration_quick_check_unavailable"
          : "migration_quick_check_ok",
    },
    backup: {
      state: notRequired ? "not_required" : unavailable ? "unavailable" : blocked ? "missing" : "ready",
      ageMs: state === "ready" ? 500 : null,
      maxAgeMs: 86400000,
      code: notRequired
        ? "migration_backup_not_required"
        : unavailable
          ? "migration_backup_unavailable"
          : blocked
            ? "migration_backup_missing"
            : "migration_backup_ready",
    },
    lock: {
      state: notRequired ? "not_required" : unavailable ? "unavailable" : "available",
      blocking: unavailable,
      ageMs: null,
      ttlMs: 60000,
      code: notRequired
        ? "migration_lock_not_required"
        : unavailable
          ? "migration_lock_unavailable"
          : "migration_lock_available",
    },
  };
}

function deps(overrides = {}) {
  return {
    access: () => ({ role: "admin", identity: "admin@example.test", groups: [] }),
    createContext: () => ({
      correlationId: "cor_preflight123",
      actorIdentity: "admin@example.test",
      actorRole: "admin",
      actorGroups: [],
    }),
    inspect: async () => report(),
    appendAudit: async () => {},
    now: (() => {
      let value = 1000;
      return () => value++;
    })(),
    ...overrides,
  };
}

function request(body = "{}", init = {}) {
  return new Request(`https://portal.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body,
    ...init,
  });
}

test("preflight handler ignores unrelated path and enforces POST", async () => {
  assert.equal(await handleStorageMigrationPreflightRequest(
    new Request("https://portal.example/api/other", { method: "POST" }),
    {},
    deps(),
  ), null);

  const response = await handleStorageMigrationPreflightRequest(
    new Request(`https://portal.example${path}`, { method: "GET" }),
    {},
    deps(),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("viewer and operator are denied before malformed body, context, evaluator and D1", async () => {
  for (const role of ["viewer", "operator"]) {
    const calls = [];
    const response = await handleStorageMigrationPreflightRequest(
      request("{"),
      { DB: new Proxy({}, { get() { calls.push("db"); throw new Error("db"); } }) },
      deps({
        access: () => ({ role, identity: `${role}@example.test`, groups: [] }),
        createContext: () => { calls.push("context"); throw new Error("context"); },
        inspect: async () => { calls.push("inspect"); throw new Error("inspect"); },
      }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(calls, []);
  }
});

test("request body must be exactly an empty JSON object and at most 1 KiB", async () => {
  for (const [body, status] of [
    ["{", 400],
    ["null", 400],
    ["[]", 400],
    ["{\"targetVersion\":4}", 400],
    [`{"padding":"${"x".repeat(1100)}"}`, 413],
  ]) {
    const response = await handleStorageMigrationPreflightRequest(request(body), {}, deps());
    assert.equal(response.status, status, body.slice(0, 30));
  }
  const declared = await handleStorageMigrationPreflightRequest(request("{}", {
    headers: { "content-length": "1025" },
  }), {}, deps());
  assert.equal(declared.status, 413);
});

test("valid reports preserve status semantics, correlation ID and bounded safe audit", async () => {
  for (const [state, status] of [
    ["ready", 200],
    ["not_required", 200],
    ["blocked", 200],
    ["unavailable", 503],
  ]) {
    const audits = [];
    const response = await handleStorageMigrationPreflightRequest(request(), {}, deps({
      inspect: async () => report(state),
      appendAudit: async (_env, _context, event) => audits.push(event),
    }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-correlation-id"), "cor_preflight123");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.state, state);
    assert.equal(body.correlationId, "cor_preflight123");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "storage.migration.preflight");
    assert.equal(JSON.stringify(audits[0]).includes("admin@example.test"), false);
  }
});

test("audit failure does not replace result and unexpected errors return full safe unavailable report", async () => {
  const success = await handleStorageMigrationPreflightRequest(request(), {}, deps({
    appendAudit: async () => { throw new Error("audit-secret"); },
  }));
  assert.equal(success.status, 200);

  const failure = await handleStorageMigrationPreflightRequest(request(), {}, deps({
    inspect: async () => { throw new Error("/var/lib/private.sqlite token-secret"); },
    appendAudit: async () => { throw new Error("audit-secret"); },
  }));
  assert.equal(failure.status, 503);
  const payload = await failure.json();
  assert.deepEqual(Object.keys(payload).sort(), [
    "backup", "code", "contractVersion", "correlationId", "decision", "durationMs",
    "generatedAt", "integrity", "journal", "lock", "pendingMigrationCount", "schema", "state",
  ].sort());
  assert.equal(payload.state, "unavailable");
  assert.equal(payload.decision, "deny");
  assert.equal(payload.correlationId, "cor_preflight123");
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("private.sqlite"), false);
  assert.equal(serialized.includes("token-secret"), false);
  assert.equal(serialized.includes("audit-secret"), false);
});