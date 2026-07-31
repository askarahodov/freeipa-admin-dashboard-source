import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSelectiveBackupRestoreRequest,
} from "../worker/backup-selective-restore-entry.ts";

const context = {
  correlationId: "cor_11111111111111111111",
  actor: { identity: "admin@example.test", role: "admin", groups: ["portal-admins"] },
};
const schema = { state: "ready", currentVersion: 2, latestVersion: 2, appliedVersions: [1, 2] };
const stageId = "restore_11111111-1111-4111-8111-111111111111";
const stageSecret = "A".repeat(43);
const prepareInput = {
  operation: "restore",
  document: { manifest: { mode: "encrypted" } },
  password: "source-password-value",
  domains: ["policies"],
  approvalToken: "1".repeat(64),
  recoveryPassword: "recovery-password-value",
};
const commitInput = {
  ...prepareInput,
  recoveryDocument: { manifest: { mode: "encrypted" } },
  stageId,
  stageSecret,
  acknowledgeRecoverySaved: true,
  confirmation: `RESTORE:${stageId}`,
};
const prepareResult = {
  prepared: true,
  productionMutated: false,
  operation: "restore",
  selectedDomains: ["policies"],
  sourceSchemaVersion: 2,
  currentSchemaVersion: 2,
  stage: { id: stageId, secret: stageSecret, expiresAt: 901000 },
  isolated: {
    tested: true,
    productionMutated: false,
    selectedDomains: ["policies"],
    sourceSchemaVersion: 2,
    currentSchemaVersion: 2,
    canCommit: true,
    summary: { domains: 1, tables: 3, records: 3, checks: 3, warnings: 0 },
    domains: [],
  },
  recovery: {
    document: { manifest: { mode: "encrypted" }, payloads: {}, summary: { entries: 1, records: 3, bytes: 100 } },
    summary: { domains: 1, tables: 3, records: 3 },
  },
};
const commitResult = {
  committed: true,
  productionMutated: true,
  operation: "restore",
  stageId,
  selectedDomains: ["policies"],
  sourceSchemaVersion: 2,
  currentSchemaVersion: 2,
  summary: { domains: 1, tables: 3, records: 3, checks: 3, warnings: 0 },
};

function request(path, body, options = {}) {
  const headers = new Headers({
    origin: "https://portal.example",
    "content-type": "application/json",
    ...(options.headers ?? {}),
  });
  if (options.noOrigin) headers.delete("origin");
  return new Request(`https://portal.example${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

function fixture(overrides = {}) {
  const calls = [];
  const audit = [];
  const dependencies = {
    async inspectSchema() { calls.push("schema"); return schema; },
    async prepareRestore(env, input, receivedSchema, actor) {
      calls.push("prepare");
      assert.equal(input.password, prepareInput.password);
      assert.equal(receivedSchema, schema);
      assert.equal(actor, context.actor.identity);
      return prepareResult;
    },
    async commitRestore(env, input, receivedSchema, actor, sanitized, full, coreDependencies) {
      calls.push("commit");
      assert.equal(input.recoveryPassword, commitInput.recoveryPassword);
      assert.equal(receivedSchema, schema);
      assert.deepEqual(actor, { identity: context.actor.identity, groups: context.actor.groups });
      assert.equal(coreDependencies.createCorrelationId(), context.correlationId);
      return commitResult;
    },
    async hashSecret(secret) { calls.push("hash-secret"); assert.equal(secret, stageSecret); return "3".repeat(64); },
    async cancelStage(db, input) {
      calls.push("cancel");
      assert.equal(input.id, stageId);
      assert.equal(input.actorIdentity, context.actor.identity);
      assert.equal(input.stageSecretHash, "3".repeat(64));
      return { cancelled: true, status: "cancelled" };
    },
    async appendAudit(env, receivedContext, event) {
      calls.push("audit");
      assert.equal(receivedContext, context);
      audit.push(event);
      return null;
    },
    now: () => 1000,
    ...overrides,
  };
  return { calls, audit, dependencies };
}

test("prepare returns no-store recovery document and audits aggregates without secrets", async () => {
  const f = fixture();
  const response = await handleSelectiveBackupRestoreRequest(
    request("/api/admin/backups/import/encrypted/prepare-commit", prepareInput),
    { DB: {} },
    context,
    f.dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), prepareResult);
  assert.deepEqual(f.calls, ["schema", "prepare", "audit"]);
  assert.equal(f.audit[0].action, "backup.selective.prepare.completed");
  assert.equal(f.audit[0].outcome, "pending");
  assert.deepEqual(f.audit[0].metadata.domains, ["policies"]);
  const serializedAudit = JSON.stringify(f.audit);
  for (const forbidden of [prepareInput.password, prepareInput.recoveryPassword, prepareInput.approvalToken, stageSecret]) {
    assert.equal(serializedAudit.includes(forbidden), false);
  }
});

test("commit delegates aggregate audit to the atomic batch", async () => {
  const f = fixture();
  const response = await handleSelectiveBackupRestoreRequest(
    request("/api/admin/backups/import/encrypted/commit", commitInput),
    { DB: { batch() {} } },
    context,
    f.dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), commitResult);
  assert.deepEqual(f.calls, ["schema", "commit"]);
  assert.deepEqual(f.audit, []);
});

test("cancel hashes the one-time secret and writes only a safe audit event", async () => {
  const f = fixture();
  const response = await handleSelectiveBackupRestoreRequest(
    request("/api/admin/backups/import/encrypted/cancel", { stageId, stageSecret }),
    { DB: {} },
    context,
    f.dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cancelled: true, status: "cancelled", stageId });
  assert.deepEqual(f.calls, ["hash-secret", "cancel", "audit"]);
  assert.equal(f.audit[0].action, "backup.selective.cancel.completed");
  assert.equal(f.audit[0].resourceId, stageId);
  assert.equal(JSON.stringify(f.audit).includes(stageSecret), false);
});

test("same-origin and method checks run before schema, body-dependent handlers and DB work", async () => {
  for (const [req, status, code] of [
    [request("/api/admin/backups/import/encrypted/prepare-commit", prepareInput, { noOrigin: true }), 403, "backup_origin_forbidden"],
    [request("/api/admin/backups/import/encrypted/commit", commitInput, { method: "GET" }), 405, "backup_method_not_allowed"],
    [request("/api/admin/backups/import/encrypted/cancel", { stageId, stageSecret }, { noOrigin: true }), 403, "backup_origin_forbidden"],
  ]) {
    const f = fixture();
    const response = await handleSelectiveBackupRestoreRequest(req, { DB: {} }, context, f.dependencies);
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.deepEqual(f.calls, []);
  }
});

test("rejects oversized and malformed requests before restore cores", async () => {
  for (const req of [
    request("/api/admin/backups/import/encrypted/prepare-commit", "{}", { headers: { "content-length": String(43 * 1024 * 1024) } }),
    request("/api/admin/backups/import/encrypted/prepare-commit", "{"),
    request("/api/admin/backups/import/encrypted/cancel", { stageId, stageSecret, extra: true }),
  ]) {
    const f = fixture();
    const response = await handleSelectiveBackupRestoreRequest(req, { DB: {} }, context, f.dependencies);
    assert.equal([400, 413].includes(response.status), true);
    assert.deepEqual(f.calls, []);
  }
});

test("normalizes prepare commit and cancel failures without leaking request material", async () => {
  const cases = [
    ["/api/admin/backups/import/encrypted/prepare-commit", prepareInput, "prepareRestore", "backup_restore_admin_required", 422],
    ["/api/admin/backups/import/encrypted/commit", commitInput, "commitRestore", "backup_recovery_point_stale", 409],
    ["/api/admin/backups/import/encrypted/cancel", { stageId, stageSecret }, "cancelStage", "backup_restore_stage_cancelled", 409],
  ];
  for (const [path, body, dependency, code, status] of cases) {
    const f = fixture({
      async [dependency]() {
        f.calls.push(dependency === "cancelStage" ? "cancel" : dependency === "prepareRestore" ? "prepare" : "commit");
        throw Object.assign(new Error(`raw ${prepareInput.password} ${stageSecret}`), { code });
      },
    });
    const response = await handleSelectiveBackupRestoreRequest(request(path, body), { DB: {} }, context, f.dependencies);
    assert.equal(response.status, status);
    const payload = await response.json();
    assert.equal(payload.code, code);
    assert.equal(JSON.stringify(payload).includes(prepareInput.password), false);
    assert.equal(JSON.stringify(payload).includes(stageSecret), false);
    assert.equal(f.audit.at(-1)?.outcome, "failure");
    assert.equal(JSON.stringify(f.audit).includes(stageSecret), false);
  }
});
