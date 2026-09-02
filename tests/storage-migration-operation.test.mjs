import assert from "node:assert/strict";
import test from "node:test";

import {
  createMigrationOperationId,
  migrationApplyConfirmation,
  normalizeMigrationOperationRow,
  publicIdleMigrationOperation,
} from "../src/storage/migration/operation/storage-migration-operation.ts";

const maintenanceId = "maintenance_00000000-0000-4000-8000-000000000000";

test("migration operation ids and confirmation are deterministic and bounded", () => {
  const id = createMigrationOperationId(() => "00000000-0000-4000-8000-000000000000");
  assert.equal(id, "migration_00000000-0000-4000-8000-000000000000");
  assert.equal(migrationApplyConfirmation(maintenanceId, 4, 5), `APPLY:${maintenanceId}:4:5`);
  assert.throws(() => migrationApplyConfirmation("bad", 4, 5), /migration_apply_request_invalid/);
});

test("operation rows normalize safe states and reject malformed values", () => {
  const row = normalizeMigrationOperationRow({
    id: "main",
    operation_id: "migration_00000000-0000-4000-8000-000000000000",
    maintenance_operation_id: maintenanceId,
    from_version: 4,
    target_version: 5,
    total_count: 1,
    applied_count: 0,
    state: "running",
    created_at: 100,
    started_at: 100,
    updated_at: 100,
    completed_at: null,
    failure_code: null,
  });
  assert.equal(row.state, "running");
  assert.equal(row.recoveryRequired, true);
  assert.equal(JSON.stringify(row).includes("maintenance_"), false);
  assert.throws(() => normalizeMigrationOperationRow({ ...row, id: "other" }), /migration_operation_unavailable/);
});

test("idle projection is fixed and contains no internal identifiers", () => {
  assert.deepEqual(publicIdleMigrationOperation(), {
    contractVersion: "1",
    state: "idle",
    operationId: null,
    fromVersion: 0,
    currentVersion: 0,
    targetVersion: 0,
    totalCount: 0,
    appliedCount: 0,
    createdAt: null,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    failureCode: null,
    recoveryRequired: false,
    correlationId: null,
  });
});
