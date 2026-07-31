import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupRestoreStageRepositoryError,
  cancelRestoreStage,
  createRestoreStage,
  loadRestoreStage,
} from "../backup-restore-stage-repository.ts";

function resultChanges(changes) {
  return { meta: { changes } };
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    this.db.calls.push({ kind: "run", sql: this.sql, values: this.values });
    return this.db.runResults.shift() ?? resultChanges(1);
  }

  async first() {
    this.db.calls.push({ kind: "first", sql: this.sql, values: this.values });
    return this.db.firstResults.shift() ?? null;
  }
}

class FakeDb {
  constructor() {
    this.calls = [];
    this.runResults = [];
    this.firstResults = [];
  }

  prepare(sql) {
    assert.equal(sql.includes("SELECT *"), false);
    return new FakeStatement(this, sql);
  }
}

const input = {
  id: "restore_11111111-1111-4111-8111-111111111111",
  operation: "restore",
  actorIdentity: "admin",
  selectedDomains: ["settings", "policies"],
  stageSecretHash: "1".repeat(64),
  sourceBindingHash: "2".repeat(64),
  recoveryBindingHash: "3".repeat(64),
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  createdAt: 1_000,
  expiresAt: 901_000,
};

test("creates a prepared metadata-only restore stage with exact parameters", async () => {
  const db = new FakeDb();
  const result = await createRestoreStage(db, input);
  assert.deepEqual(result, { ...input, status: "prepared", completedAt: null });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /^INSERT INTO portal_backup_restore_stages \(/);
  assert.deepEqual(db.calls[0].values, [
    input.id,
    input.operation,
    input.actorIdentity,
    JSON.stringify(input.selectedDomains),
    input.stageSecretHash,
    input.sourceBindingHash,
    input.recoveryBindingHash,
    input.sourceSchemaVersion,
    input.currentSchemaVersion,
    "prepared",
    input.createdAt,
    input.expiresAt,
  ]);
  for (const forbidden of ["password", "document", "ciphertext", "approval_token", "plaintext"]) {
    assert.equal(db.calls[0].sql.toLowerCase().includes(forbidden), false, forbidden);
  }
});

test("loads only explicit stage metadata columns", async () => {
  const db = new FakeDb();
  db.firstResults.push({
    id: input.id,
    operation: input.operation,
    actor_identity: input.actorIdentity,
    selected_domains_json: JSON.stringify(input.selectedDomains),
    stage_secret_hash: input.stageSecretHash,
    source_binding_hash: input.sourceBindingHash,
    recovery_binding_hash: input.recoveryBindingHash,
    source_schema_version: 1,
    current_schema_version: 1,
    status: "prepared",
    created_at: input.createdAt,
    expires_at: input.expiresAt,
    completed_at: null,
  });
  assert.deepEqual(await loadRestoreStage(db, input.id), { ...input, status: "prepared", completedAt: null });
  assert.match(db.calls[0].sql, /^SELECT id, operation, actor_identity,/);
});

test("cancels only a matching unexpired prepared stage", async () => {
  const db = new FakeDb();
  db.runResults.push(resultChanges(1));
  const result = await cancelRestoreStage(db, {
    id: input.id,
    actorIdentity: input.actorIdentity,
    stageSecretHash: input.stageSecretHash,
    now: 5_000,
  });
  assert.deepEqual(result, { cancelled: true, status: "cancelled" });
  assert.match(db.calls[0].sql, /^UPDATE portal_backup_restore_stages SET status = 'cancelled'/);
  assert.deepEqual(db.calls[0].values, [5_000, input.id, input.actorIdentity, input.stageSecretHash, 5_000]);
});

test("maps cancellation conflicts to fixed stage errors", async () => {
  const cases = [
    [null, "backup_restore_stage_invalid"],
    [{ ...input, status: "cancelled", completedAt: 2_000 }, "backup_restore_stage_cancelled"],
    [{ ...input, status: "committed", completedAt: 2_000 }, "backup_restore_stage_committed"],
    [{ ...input, status: "prepared", expiresAt: 4_000, completedAt: null }, "backup_restore_stage_expired"],
  ];
  for (const [row, expected] of cases) {
    const db = new FakeDb();
    db.runResults.push(resultChanges(0));
    db.firstResults.push(row && {
      id: row.id,
      operation: row.operation,
      actor_identity: row.actorIdentity,
      selected_domains_json: JSON.stringify(row.selectedDomains),
      stage_secret_hash: row.stageSecretHash,
      source_binding_hash: row.sourceBindingHash,
      recovery_binding_hash: row.recoveryBindingHash,
      source_schema_version: row.sourceSchemaVersion,
      current_schema_version: row.currentSchemaVersion,
      status: row.status,
      created_at: row.createdAt,
      expires_at: row.expiresAt,
      completed_at: row.completedAt,
    });
    await assert.rejects(
      () => cancelRestoreStage(db, {
        id: input.id,
        actorIdentity: input.actorIdentity,
        stageSecretHash: input.stageSecretHash,
        now: 5_000,
      }),
      (error) => error instanceof BackupRestoreStageRepositoryError && error.code === expected,
    );
  }
});
