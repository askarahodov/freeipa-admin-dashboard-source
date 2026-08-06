import {
  MigrationOperationError,
  normalizeMigrationOperationRow,
  type MigrationOperationRow,
} from "./storage-migration-operation.ts";

type D1Statement = D1PreparedStatement;
type AuditStatement = D1PreparedStatement;

type BeginInput = {
  operationId: string;
  maintenanceOperationId: string;
  fromVersion: number;
  targetVersion: number;
  totalCount: number;
  now: number;
};

const selectSql = `SELECT id, operation_id, maintenance_operation_id, from_version,
  target_version, total_count, applied_count, state, created_at, started_at,
  updated_at, completed_at, failure_code
FROM portal_migration_operations WHERE id = 'main'`;

function changes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const source = value as { meta?: { changes?: unknown }; changes?: unknown };
  const number = Number(source.meta?.changes ?? source.changes ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function fail(code = "migration_operation_unavailable", status = 503): never {
  throw new MigrationOperationError(code, status);
}

function safeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail("migration_apply_request_invalid", 400);
  return number;
}

function requireDb(db: D1Database): void {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") fail();
}

async function runBatch(db: D1Database, primary: D1Statement, audit: readonly AuditStatement[]): Promise<void> {
  const results = await db.batch([primary, ...audit]);
  if (!Array.isArray(results) || results.length !== audit.length + 1 || changes(results[0]) !== 1) {
    fail("migration_apply_conflict", 409);
  }
}

export async function loadMigrationOperation(db: D1Database): Promise<MigrationOperationRow | null> {
  try {
    requireDb(db);
    const row = await db.prepare(selectSql).first<Record<string, unknown>>();
    return row ? normalizeMigrationOperationRow(row) : null;
  } catch (error) {
    if (error instanceof MigrationOperationError) throw error;
    fail();
  }
}

export async function beginMigrationOperation(db: D1Database, input: BeginInput, audit: readonly AuditStatement[] = []): Promise<MigrationOperationRow> {
  requireDb(db);
  const now = safeInteger(input.now);
  const from = safeInteger(input.fromVersion, 0, 1000);
  const target = safeInteger(input.targetVersion, from, 1000);
  const total = safeInteger(input.totalCount, 1, 1000);
  const statement = db.prepare(`INSERT INTO portal_migration_operations (
      id, operation_id, maintenance_operation_id, from_version, target_version,
      total_count, applied_count, state, created_at, started_at, updated_at,
      completed_at, failure_code
    ) VALUES ('main', ?, ?, ?, ?, ?, 0, 'running', ?, ?, ?, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      operation_id = excluded.operation_id,
      maintenance_operation_id = excluded.maintenance_operation_id,
      from_version = excluded.from_version,
      target_version = excluded.target_version,
      total_count = excluded.total_count,
      applied_count = 0,
      state = 'running',
      created_at = excluded.created_at,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at,
      completed_at = NULL,
      failure_code = NULL
    WHERE portal_migration_operations.state IN ('succeeded', 'reconciled', 'interrupted')`)
    .bind(input.operationId, input.maintenanceOperationId, from, target, total, now, now, now);
  await runBatch(db, statement, audit);
  return normalizeMigrationOperationRow({
    id: "main", operation_id: input.operationId, maintenance_operation_id: input.maintenanceOperationId,
    from_version: from, target_version: target, total_count: total, applied_count: 0,
    state: "running", created_at: now, started_at: now, updated_at: now,
    completed_at: null, failure_code: null,
  });
}

export async function recordMigrationProgress(
  db: D1Database,
  operationId: string,
  appliedCount: number,
  now: number,
  audit: readonly AuditStatement[] = [],
): Promise<void> {
  requireDb(db);
  const statement = db.prepare(`UPDATE portal_migration_operations
    SET applied_count = ?, updated_at = ?
    WHERE id = 'main' AND state = 'running' AND operation_id = ?
      AND applied_count < ? AND ? <= total_count`)
    .bind(safeInteger(appliedCount, 1, 1000), safeInteger(now), operationId, appliedCount, appliedCount);
  await runBatch(db, statement, audit);
}

export async function completeMigrationOperation(
  db: D1Database,
  operationId: string,
  appliedCount: number,
  now: number,
  audit: readonly AuditStatement[] = [],
): Promise<void> {
  requireDb(db);
  const count = safeInteger(appliedCount, 1, 1000);
  const statement = db.prepare(`UPDATE portal_migration_operations
    SET state = 'succeeded', applied_count = ?, updated_at = ?, completed_at = ?, failure_code = NULL
    WHERE id = 'main' AND state = 'running' AND operation_id = ?
      AND total_count = ?`)
    .bind(count, safeInteger(now), safeInteger(now), operationId, count);
  await runBatch(db, statement, audit);
}

export async function failMigrationOperation(
  db: D1Database,
  operationId: string,
  failureCode: string,
  now: number,
  audit: readonly AuditStatement[] = [],
): Promise<void> {
  requireDb(db);
  const allowed = new Set([
    "migration_apply_execution_failed", "migration_apply_progress_failed",
    "migration_apply_verification_failed", "migration_apply_audit_failed",
    "migration_apply_lock_lost", "migration_apply_release_failed",
    "migration_reconcile_failed", "migration_recovery_required",
  ]);
  if (!allowed.has(failureCode)) fail("migration_apply_request_invalid", 400);
  const statement = db.prepare(`UPDATE portal_migration_operations
    SET state = 'failed', updated_at = ?, completed_at = ?, failure_code = ?
    WHERE id = 'main' AND state = 'running' AND operation_id = ?`)
    .bind(safeInteger(now), safeInteger(now), failureCode, operationId);
  await runBatch(db, statement, audit);
}

export async function markMigrationInterrupted(
  db: D1Database,
  operationId: string,
  now: number,
  audit: readonly AuditStatement[] = [],
): Promise<void> {
  requireDb(db);
  const statement = db.prepare(`UPDATE portal_migration_operations
    SET state = 'interrupted', updated_at = ?, completed_at = ?, failure_code = NULL
    WHERE id = 'main' AND state IN ('running', 'failed') AND operation_id = ?`)
    .bind(safeInteger(now), safeInteger(now), operationId);
  await runBatch(db, statement, audit);
}

export async function markMigrationReconciled(
  db: D1Database,
  operationId: string,
  appliedCount: number,
  now: number,
  audit: readonly AuditStatement[] = [],
): Promise<void> {
  requireDb(db);
  const count = safeInteger(appliedCount, 1, 1000);
  const statement = db.prepare(`UPDATE portal_migration_operations
    SET state = 'reconciled', applied_count = ?, updated_at = ?, completed_at = ?, failure_code = NULL
    WHERE id = 'main' AND state IN ('running', 'failed') AND operation_id = ?
      AND total_count = ?`)
    .bind(count, safeInteger(now), safeInteger(now), operationId, count);
  await runBatch(db, statement, audit);
}
