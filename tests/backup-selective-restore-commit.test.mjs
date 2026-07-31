import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupSelectiveRestoreCommitError,
  commitSelectiveProductionRestore,
} from "../backup-selective-restore-commit.ts";

const sourceDocument = { manifest: { format: "source" } };
const recoveryDocument = { manifest: { format: "recovery" } };
const sourcePayload = { domain: "policies", schemaVersion: 1, tables: [] };
const currentPayload = { domain: "policies", schemaVersion: 1, tables: [] };
const stage = {
  id: "restore_11111111-1111-4111-8111-111111111111",
  operation: "restore",
  actorIdentity: "admin",
  selectedDomains: ["policies"],
  stageSecretHash: "3".repeat(64),
  sourceBindingHash: "4".repeat(64),
  recoveryBindingHash: "2".repeat(64),
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  status: "prepared",
  createdAt: 1_000,
  expiresAt: 901_000,
  completedAt: null,
};
const input = {
  operation: "restore",
  document: sourceDocument,
  password: "source-password-value",
  domains: ["policies"],
  approvalToken: "1".repeat(64),
  recoveryDocument,
  recoveryPassword: "recovery-password-value",
  stageId: stage.id,
  stageSecret: "A".repeat(43),
  acknowledgeRecoverySaved: true,
  confirmation: `RESTORE:${stage.id}`,
};
const schema = { state: "ready", currentVersion: 1 };
const isolated = {
  tested: true,
  productionMutated: false,
  selectedDomains: ["policies"],
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  canCommit: true,
  summary: { domains: 1, tables: 3, records: 3, checks: 3, warnings: 0 },
  domains: [],
};

class FakeDb {
  constructor() {
    this.batchCalls = [];
    this.batchResults = [
      { meta: { changes: 1 } },
      { meta: { changes: 3 } },
      { meta: { changes: 1 } },
    ];
  }

  async batch(statements) {
    this.batchCalls.push(statements);
    return this.batchResults;
  }
}

function fixture(overrides = {}) {
  const calls = [];
  const db = new FakeDb();
  const statements = [{ kind: "claim" }, { kind: "write" }, { kind: "complete" }];
  const dependencies = {
    now() { return 10_000; },
    async loadStage(receivedDb, id) {
      calls.push("load-stage");
      assert.equal(receivedDb, db);
      assert.equal(id, stage.id);
      return stage;
    },
    async verifySecret(expectedHash, secret) {
      calls.push("verify-secret");
      assert.equal(expectedHash, stage.stageSecretHash);
      assert.equal(secret, input.stageSecret);
      return true;
    },
    async testRestore(env, value, receivedSchema) {
      calls.push("test-restore");
      assert.equal(value.document, sourceDocument);
      assert.equal(value.password, input.password);
      assert.deepEqual(value.domains, ["policies"]);
      assert.equal(value.approvalToken, input.approvalToken);
      assert.equal(receivedSchema, schema);
      return isolated;
    },
    async verifyRecovery(env, document, password, policy) {
      calls.push("verify-recovery");
      assert.equal(document, recoveryDocument);
      assert.equal(password, input.recoveryPassword);
      assert.deepEqual(policy.physicalDomains, ["policies"]);
      return {
        verified: true,
        bindingHash: stage.recoveryBindingHash,
        physicalDomains: ["policies"],
        summary: { domains: 1, tables: 3, records: 3 },
        currentFullPayloads: new Map([["policies", currentPayload]]),
      };
    },
    async createBinding(value) {
      calls.push("create-binding");
      assert.equal(value.recoveryManifestChecksum, stage.recoveryBindingHash);
      assert.equal(value.expiresAt, stage.expiresAt);
      return stage.sourceBindingHash;
    },
    verifyBinding(expected, actual) {
      calls.push("verify-binding");
      return expected === actual;
    },
    async decryptSource(document, password, domains) {
      calls.push("decrypt-source");
      assert.equal(document, sourceDocument);
      assert.equal(password, input.password);
      assert.deepEqual(domains, ["policies"]);
      return {
        selectedDomains: ["policies"],
        fullPayloads: new Map([["policies", sourcePayload]]),
      };
    },
    validateCandidate(policy, payloads) {
      calls.push("validate-candidate");
      assert.deepEqual(policy.selectedDomains, ["policies"]);
      assert.equal(payloads.get("policies"), sourcePayload);
    },
    buildStatements(receivedDb, guard, policy, sourcePayloads, currentPayloads, audit) {
      calls.push("build-statements");
      assert.equal(receivedDb, db);
      assert.equal(guard.id, stage.id);
      assert.equal(guard.stageSecretHash, stage.stageSecretHash);
      assert.equal(sourcePayloads.get("policies"), sourcePayload);
      assert.equal(currentPayloads.get("policies"), currentPayload);
      assert.equal(audit.action, "backup.restore.commit");
      assert.equal(audit.metadataJson.includes(input.approvalToken), false);
      return statements;
    },
    createAuditId() { return "audit-selective-restore"; },
    createCorrelationId() { return "restore-correlation"; },
    ...overrides,
  };
  return { calls, db, dependencies, statements };
}

test("commits exactly one guarded D1 batch after every safety gate", async () => {
  const f = fixture();
  const result = await commitSelectiveProductionRestore(
    { DB: f.db },
    input,
    schema,
    { identity: "admin", groups: ["portal-admins"] },
    new Map(),
    new Map(),
    f.dependencies,
  );
  assert.deepEqual(f.calls, [
    "load-stage",
    "verify-secret",
    "test-restore",
    "verify-recovery",
    "create-binding",
    "verify-binding",
    "decrypt-source",
    "validate-candidate",
    "build-statements",
  ]);
  assert.equal(f.db.batchCalls.length, 1);
  assert.equal(f.db.batchCalls[0], f.statements);
  assert.deepEqual(result, {
    committed: true,
    productionMutated: true,
    operation: "restore",
    stageId: stage.id,
    selectedDomains: ["policies"],
    sourceSchemaVersion: 1,
    currentSchemaVersion: 1,
    summary: isolated.summary,
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [input.password, input.recoveryPassword, input.approvalToken, input.stageSecret]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("requires exact confirmation before loading the stage", async () => {
  for (const value of [
    { ...input, acknowledgeRecoverySaved: false },
    { ...input, confirmation: "RESTORE" },
    { ...input, confirmation: `ROLLBACK:${stage.id}` },
    { ...input, extra: true },
  ]) {
    const f = fixture();
    await assert.rejects(
      () => commitSelectiveProductionRestore(
        { DB: f.db }, value, schema, "admin", new Map(), new Map(), f.dependencies,
      ),
      (error) => error instanceof BackupSelectiveRestoreCommitError
        && ["backup_request_invalid", "backup_restore_confirmation_required"].includes(error.code),
    );
    assert.deepEqual(f.calls, []);
    assert.equal(f.db.batchCalls.length, 0);
  }
});

test("requires session-revocation acknowledgement for local-auth", async () => {
  const f = fixture();
  await assert.rejects(
    () => commitSelectiveProductionRestore(
      { DB: f.db },
      {
        ...input,
        domains: ["local-auth"],
        confirmation: `RESTORE:${stage.id}`,
      },
      schema,
      "admin",
      new Map(),
      new Map(),
      f.dependencies,
    ),
    (error) => error instanceof BackupSelectiveRestoreCommitError
      && error.code === "backup_restore_confirmation_required",
  );
  assert.deepEqual(f.calls, []);
});

test("rejects invalid expired cancelled or replayed stages before source crypto", async () => {
  const cases = [
    [null, "backup_restore_stage_invalid"],
    [{ ...stage, actorIdentity: "other" }, "backup_restore_stage_invalid"],
    [{ ...stage, status: "cancelled" }, "backup_restore_stage_cancelled"],
    [{ ...stage, status: "committed" }, "backup_restore_stage_committed"],
    [{ ...stage, expiresAt: 9_000 }, "backup_restore_stage_expired"],
  ];
  for (const [stageValue, code] of cases) {
    const f = fixture({ async loadStage() { f.calls.push("load-stage"); return stageValue; } });
    await assert.rejects(
      () => commitSelectiveProductionRestore(
        { DB: f.db }, input, schema, "admin", new Map(), new Map(), f.dependencies,
      ),
      (error) => error instanceof BackupSelectiveRestoreCommitError && error.code === code,
    );
    assert.equal(f.calls.includes("test-restore"), false);
    assert.equal(f.db.batchCalls.length, 0);
  }
});

test("rejects stale source binding or recovery before building DML", async () => {
  for (const kind of ["test", "recovery", "binding"]) {
    const f = fixture({
      ...(kind === "test" ? {
        async testRestore() {
          f.calls.push("test-restore");
          throw Object.assign(new Error("unsafe detail"), { code: "backup_restore_stale" });
        },
      } : {}),
      ...(kind === "recovery" ? {
        async verifyRecovery() {
          f.calls.push("verify-recovery");
          throw Object.assign(new Error("unsafe detail"), { code: "backup_recovery_point_stale" });
        },
      } : {}),
      ...(kind === "binding" ? {
        verifyBinding() { f.calls.push("verify-binding"); return false; },
      } : {}),
    });
    await assert.rejects(
      () => commitSelectiveProductionRestore(
        { DB: f.db }, input, schema, "admin", new Map(), new Map(), f.dependencies,
      ),
      (error) => error instanceof BackupSelectiveRestoreCommitError
        && ["backup_restore_stale", "backup_recovery_point_stale"].includes(error.code),
    );
    assert.equal(f.calls.includes("build-statements"), false);
    assert.equal(f.db.batchCalls.length, 0);
  }
});

test("normalizes batch failures and rejects a zero-change stage claim", async () => {
  {
    const f = fixture();
    f.db.batch = async () => { throw new Error("raw D1 detail"); };
    await assert.rejects(
      () => commitSelectiveProductionRestore(
        { DB: f.db }, input, schema, "admin", new Map(), new Map(), f.dependencies,
      ),
      (error) => error instanceof BackupSelectiveRestoreCommitError
        && error.code === "backup_restore_commit_failed"
        && !error.message.includes("raw D1"),
    );
  }
  {
    const f = fixture();
    f.db.batchResults[0] = { meta: { changes: 0 } };
    await assert.rejects(
      () => commitSelectiveProductionRestore(
        { DB: f.db }, input, schema, "admin", new Map(), new Map(), f.dependencies,
      ),
      (error) => error instanceof BackupSelectiveRestoreCommitError
        && error.code === "backup_recovery_point_stale",
    );
  }
});
