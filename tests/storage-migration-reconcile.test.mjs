import assert from "node:assert/strict";
import test from "node:test";
import { reconcileControlledStorageMigration } from "../storage-migration-apply.ts";

const maintenanceOperationId = "maintenance_00000000-0000-4000-8000-000000000000";
const operationId = "migration_00000000-0000-4000-8000-000000000000";
const context = { correlationId: "cor_abcdefghijklmnopqrst", actor: { identity: "admin", role: "admin", groups: [] } };
const input = { maintenanceOperationId, controllerSecret: "a".repeat(43), confirmation: `RECONCILE:${maintenanceOperationId}` };
const row = { operationId, maintenanceOperationId, fromVersion: 4, targetVersion: 5, totalCount: 1, appliedCount: 0, state: "running", createdAt: 1, startedAt: 1, updatedAt: 1, completedAt: null, failureCode: null, recoveryRequired: true };

function deps(classification, events = []) {
  return {
    now: () => 10,
    createOwner: () => "owner",
    verifyMaintenance: async () => events.push("maintenance"),
    loadOperation: async () => row,
    prepareAudit: async (_db, action) => ({ action }),
    acquireLock: async () => { events.push("lock"); return true; },
    classifyReconciliation: async () => { events.push("classify"); return classification; },
    markInterrupted: async () => events.push("interrupted"),
    markReconciled: async () => events.push("reconciled"),
    failOperation: async (_db, _id, code) => events.push(`failed:${code}`),
    releaseLock: async () => events.push("release"),
  };
}

test("reconcile with no operation returns fixed not-required error", async () => {
  const d = deps({ state: "interrupted" });
  d.loadOperation = async () => null;
  await assert.rejects(() => reconcileControlledStorageMigration({ DB: {} }, context, input, d), /migration_reconcile_not_required/);
});

test("reconcile classifies no committed mutation as interrupted without migration SQL", async () => {
  const events = [];
  const result = await reconcileControlledStorageMigration({ DB: {} }, context, input, deps({ state: "interrupted" }, events));
  assert.equal(result.state, "interrupted");
  assert.deepEqual(events, ["maintenance", "lock", "classify", "interrupted", "release"]);
});

test("reconcile marks fully valid target reconciled", async () => {
  const events = [];
  const result = await reconcileControlledStorageMigration({ DB: {} }, context, input, deps({ state: "reconciled", appliedCount: 1 }, events));
  assert.equal(result.state, "reconciled");
  assert.ok(events.includes("reconciled"));
});

test("reconcile marks partial or ambiguous state restore-required", async () => {
  const events = [];
  const result = await reconcileControlledStorageMigration({ DB: {} }, context, input, deps({ state: "failed", code: "migration_reconcile_restore_required" }, events));
  assert.equal(result.state, "failed");
  assert.equal(result.failureCode, "migration_reconcile_restore_required");
  assert.ok(events.includes("failed:migration_reconcile_restore_required"));
});
