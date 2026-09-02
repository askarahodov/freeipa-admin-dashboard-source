import assert from "node:assert/strict";
import test from "node:test";

import {
  beginMigrationOperation,
  loadMigrationOperation,
  recordMigrationProgress,
  completeMigrationOperation,
  failMigrationOperation,
  markMigrationInterrupted,
  markMigrationReconciled,
} from "../src/storage/migration/operation/storage-migration-operation-repository.ts";

function result(changes = 1) { return { meta: { changes } }; }
function dbWith({ first = null, batch = [result()] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return {
            first: async () => first,
            run: async () => result(),
          };
        },
        first: async () => first,
      };
    },
    batch: async (statements) => { calls.push({ batch: statements.length }); return batch; },
  };
}

const operation = {
  operationId: "migration_00000000-0000-4000-8000-000000000000",
  maintenanceOperationId: "maintenance_00000000-0000-4000-8000-000000000000",
  fromVersion: 4,
  targetVersion: 5,
  totalCount: 1,
  now: 100,
};

test("load returns idle when no row exists", async () => {
  const db = dbWith();
  assert.equal(await loadMigrationOperation(db), null);
  assert.match(db.calls[0].sql, /FROM portal_migration_operations/);
});

test("begin uses a bounded singleton row and rejects active conflict", async () => {
  const db = dbWith({ batch: [result(1)] });
  const row = await beginMigrationOperation(db, operation);
  assert.equal(row.state, "running");
  assert.equal(row.appliedCount, 0);
  assert.equal(db.calls.at(-1).batch, 1);

  const conflict = dbWith({ batch: [result(0)] });
  await assert.rejects(() => beginMigrationOperation(conflict, operation), /migration_apply_conflict/);
});

test("progress and terminal transitions require exact running operation", async () => {
  const db = dbWith({ batch: [result(1)] });
  await recordMigrationProgress(db, operation.operationId, 1, 120, []);
  await completeMigrationOperation(db, operation.operationId, 1, 130, []);
  await failMigrationOperation(db, operation.operationId, "migration_apply_execution_failed", 140, []);
  assert.ok(db.calls.some((call) => typeof call.sql === "string" && /state = 'running'/.test(call.sql)));
});

test("reconcile terminal transitions are fixed and owner-independent", async () => {
  const interrupted = dbWith({ batch: [result(1)] });
  await markMigrationInterrupted(interrupted, operation.operationId, 200, []);
  const reconciled = dbWith({ batch: [result(1)] });
  await markMigrationReconciled(reconciled, operation.operationId, 1, 210, []);
  assert.match(interrupted.calls[0].sql, /state = 'interrupted'/);
  assert.match(reconciled.calls[0].sql, /state = 'reconciled'/);
});

test("repository never persists secret, sql or actor fields", async () => {
  const db = dbWith({ batch: [result(1)] });
  await beginMigrationOperation(db, operation);
  const serialized = JSON.stringify(db.calls);
  for (const forbidden of ["controller_secret", "actor_identity", "checksum", "migration_sql", "lock_owner"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
