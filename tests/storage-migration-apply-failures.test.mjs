import assert from "node:assert/strict";
import test from "node:test";
import { applyControlledStorageMigrations } from "../storage-migration-apply.ts";

const maintenanceOperationId = "maintenance_00000000-0000-4000-8000-000000000000";
const operationId = "migration_00000000-0000-4000-8000-000000000000";
const input = { maintenanceOperationId, controllerSecret: "a".repeat(43), confirmation: `APPLY:${maintenanceOperationId}:4:5` };
const context = { correlationId: "cor_abcdefghijklmnopqrst", actor: { identity: "admin", role: "admin", groups: [] } };
const registry = [1,2,3,4].map((version) => ({ version, name: `v${version}`, mode: "automatic", statements: ["SELECT 1"], snapshot: { tables: [], indexes: [], triggers: [] }, checksum: async () => "a".repeat(64) })).concat([{ version: 5, name: "v5", mode: "controlled", statements: ["SELECT 1"], snapshot: { tables: [], indexes: [], triggers: [] }, checksum: async () => "b".repeat(64) }]);
const report = {
  contractVersion: "1", state: "ready", decision: "allow", code: "migration_preflight_ready", generatedAt: 1, durationMs: 1, pendingMigrationCount: 1,
  schema: { state: "ready", currentVersion: 4, latestVersion: 5, code: "migration_schema_ready" },
  journal: { state: "valid", appliedCount: 4, pendingCount: 1, code: "migration_journal_valid" },
  integrity: { state: "healthy", code: "migration_quick_check_healthy" }, backup: { state: "ready", ageMs: 1, maxAgeMs: 1, code: "migration_backup_ready" },
  lock: { state: "available", blocking: false, ageMs: null, ttlMs: 60000, code: "migration_lock_available" },
};
function base(events = []) {
  return {
    registry,
    now: () => 100,
    createOwner: () => "owner",
    createOperationId: () => operationId,
    verifyMaintenance: async () => events.push("maintenance"),
    inspectPlan: async () => report,
    loadOperation: async () => null,
    prepareAudit: async (_db, action) => ({ action }),
    acquireLock: async () => true,
    inspectLockedPreflight: async () => report,
    beginOperation: async () => ({ operationId, maintenanceOperationId, fromVersion: 4, targetVersion: 5, totalCount: 1, appliedCount: 0, state: "running", createdAt: 100, startedAt: 100, updatedAt: 100, completedAt: null, failureCode: null, recoveryRequired: true }),
    applyMigration: async () => {},
    inspectFinalSchema: async () => true,
    quickCheck: async () => ({ state: "healthy" }),
    completeOperation: async () => {},
    failOperation: async (_db, _id, code) => events.push(`fail:${code}`),
    markMaintenanceFailed: async (_db, code) => events.push(`maintenance-failed:${code}`),
    releaseLock: async () => events.push("release"),
  };
}

test("held lock blocks before operation row or migration SQL", async () => {
  let began = false;
  let applied = false;
  const deps = base();
  deps.acquireLock = async () => false;
  deps.beginOperation = async () => { began = true; };
  deps.applyMigration = async () => { applied = true; };
  await assert.rejects(() => applyControlledStorageMigrations({ DB: {} }, context, input, deps), /migration_apply_busy/);
  assert.equal(began, false);
  assert.equal(applied, false);
});

test("start audit preparation failure executes no migration SQL", async () => {
  let acquired = false;
  let applied = false;
  const deps = base();
  deps.prepareAudit = async () => { throw new Error("raw secret failure"); };
  deps.acquireLock = async () => { acquired = true; return true; };
  deps.applyMigration = async () => { applied = true; };
  await assert.rejects(() => applyControlledStorageMigrations({ DB: {} }, context, input, deps), /migration_apply_audit_unavailable/);
  assert.equal(acquired, false);
  assert.equal(applied, false);
});

test("post-start migration failure is normalized, persisted and keeps maintenance recovery-required", async () => {
  const events = [];
  const deps = base(events);
  deps.applyMigration = async () => { throw new Error("SQL and controllerSecret must not leak"); };
  await assert.rejects(
    () => applyControlledStorageMigrations({ DB: {} }, context, input, deps),
    (error) => error.code === "migration_apply_failed" && !String(error).includes("controllerSecret"),
  );
  assert.deepEqual(events, [
    "maintenance",
    "fail:migration_apply_failed",
    "maintenance-failed:migration_apply_failed",
    "release",
  ]);
});

test("final quick check failure becomes recovery-required and never commits success", async () => {
  const events = [];
  const deps = base(events);
  let completed = false;
  deps.quickCheck = async () => ({ state: "corrupt" });
  deps.completeOperation = async () => { completed = true; };
  await assert.rejects(() => applyControlledStorageMigrations({ DB: {} }, context, input, deps), /migration_apply_verification_failed/);
  assert.equal(completed, false);
  assert.ok(events.includes("fail:migration_apply_verification_failed"));
});
