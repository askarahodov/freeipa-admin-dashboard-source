import assert from "node:assert/strict";
import test from "node:test";

import { applyControlledStorageMigrations } from "../storage-migration-apply.ts";

const maintenanceOperationId = "maintenance_00000000-0000-4000-8000-000000000000";
const controllerSecret = "a".repeat(43);
const operationId = "migration_00000000-0000-4000-8000-000000000000";
const actor = { identity: "admin@example.test", role: "admin", groups: ["admins"] };

function migration(version, mode = "controlled") {
  return {
    version,
    name: `v${version}`,
    mode,
    statements: [`CREATE TABLE IF NOT EXISTS t${version} (id TEXT)`],
    snapshot: { tables: [], indexes: [], triggers: [] },
    checksum: async () => `${version}`.repeat(64).slice(0, 64),
  };
}

function readyReport() {
  return {
    contractVersion: "1",
    state: "ready",
    decision: "allow",
    code: "migration_preflight_ready",
    generatedAt: 100,
    durationMs: 1,
    pendingMigrationCount: 1,
    schema: { state: "ready", currentVersion: 4, latestVersion: 5, code: "migration_schema_ready" },
    journal: { state: "valid", appliedCount: 4, pendingCount: 1, code: "migration_journal_valid" },
    integrity: { state: "healthy", code: "migration_quick_check_healthy" },
    backup: { state: "ready", ageMs: 1, maxAgeMs: 86400000, code: "migration_backup_ready" },
    lock: { state: "available", blocking: false, ageMs: null, ttlMs: 60000, code: "migration_lock_available" },
  };
}

function runningRow() {
  return {
    operationId,
    maintenanceOperationId,
    fromVersion: 4,
    targetVersion: 5,
    totalCount: 1,
    appliedCount: 0,
    state: "running",
    createdAt: 100,
    startedAt: 100,
    updatedAt: 100,
    completedAt: null,
    failureCode: null,
    recoveryRequired: true,
  };
}

test("controlled apply follows maintenance, audit, lock, preflight, migration, verification and release order", async () => {
  const events = [];
  const db = {};
  const report = readyReport();
  const result = await applyControlledStorageMigrations(
    { DB: db },
    { correlationId: "cor_abcdefghijklmnopqrst", actor },
    {
      maintenanceOperationId,
      controllerSecret,
      confirmation: `APPLY:${maintenanceOperationId}:4:5`,
    },
    {
      registry: [migration(1, "automatic"), migration(2, "automatic"), migration(3, "automatic"), migration(4, "automatic"), migration(5)],
      now: () => 100,
      createOwner: () => "owner-internal",
      createOperationId: () => operationId,
      verifyMaintenance: async () => { events.push("maintenance"); },
      inspectPlan: async () => { events.push("plan"); return report; },
      loadOperation: async () => { events.push("operation:load"); return null; },
      prepareAudit: async (_db, action) => { events.push(`audit:${action}`); return { action }; },
      acquireLock: async () => { events.push("lock:acquire"); return true; },
      inspectLockedPreflight: async () => { events.push("preflight:locked"); return report; },
      beginOperation: async () => { events.push("operation:begin"); return runningRow(); },
      applyMigration: async (_db, item) => { events.push(`migration:${item.version}`); },
      inspectFinalSchema: async () => { events.push("verify:schema"); return true; },
      quickCheck: async () => { events.push("verify:quick"); return { state: "healthy" }; },
      completeOperation: async () => { events.push("operation:complete"); },
      releaseLock: async () => { events.push("lock:release"); },
    },
  );

  assert.deepEqual(events, [
    "maintenance",
    "plan",
    "operation:load",
    "audit:storage.migration.apply.started",
    "lock:acquire",
    "preflight:locked",
    "operation:begin",
    "audit:storage.migration.apply.progress",
    "migration:5",
    "verify:schema",
    "verify:quick",
    "audit:storage.migration.apply.completed",
    "operation:complete",
    "lock:release",
  ]);
  assert.equal(result.state, "succeeded");
  assert.equal(result.currentVersion, 5);
  assert.equal(result.recoveryRequired, false);
});
