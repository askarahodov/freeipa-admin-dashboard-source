import { createAuditContext, sanitizeAuditMetadata } from "../../../../audit-log.ts";
import { type PortalMigrationLockOptions } from "../../../../db/portal-migration-lock.ts";
import {
  controlledPendingMigrations,
  type ManagedPortalMigration,
} from "../../../../db/portal-migration-registry.ts";
import { portalMigrationsV4 } from "../../../../db/portal-migrations-v4.ts";
import { inspectPortalSchemaWithManagedRegistry } from "../../../../db/portal-controlled-migrations.ts";
import { loadMaintenanceState } from "../../../../maintenance-repository.ts";
import { verifyMaintenanceControllerSecret } from "../../../../maintenance-mode.ts";
import {
  loadMigrationOperation,
  type beginMigrationOperation,
  type completeMigrationOperation,
  type failMigrationOperation,
  type markMigrationInterrupted,
  type markMigrationReconciled,
} from "../operation/storage-migration-operation-repository.ts";
import {
  publicIdleMigrationOperation,
  publicMigrationOperation,
  type MigrationOperationRow,
  type PublicMigrationOperation,
} from "../operation/storage-migration-operation.ts";
import { inspectStorageMigrationPreflight } from "../../../../storage-migration-preflight.ts";
import { inspectStorageMigrationPreflightWithOwnedLock } from "../preflight/storage-migration-locked-preflight.ts";
import type { StorageMigrationPreflightReport } from "../preflight/storage-migration-preflight-contract.ts";
import { inspectStorageQuickCheck, type StorageQuickCheckResult } from "../../integrity/storage-quick-check.ts";
import type {
  StorageMigrationApplyContext,
  StorageMigrationApplyInput,
} from "./storage-migration-apply-contract.ts";
import type { applyControlledMigrationWithOwnedLock } from "./storage-migration-apply-executor.ts";

export class StorageMigrationApplyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.name = "StorageMigrationApplyError";
    this.code = code;
    this.status = status;
  }
}

export type MigrationEnv = { DB?: D1Database };
export type AuditStatement = D1PreparedStatement;
export type ReconcileClassification =
  | { state: "interrupted" }
  | { state: "reconciled"; appliedCount: number }
  | { state: "failed"; code: "migration_reconcile_restore_required" | "migration_reconcile_failed" };

export type ApplyDependencies = {
  registry?: readonly ManagedPortalMigration[];
  now?: () => number;
  createOwner?: () => string;
  createOperationId?: () => string;
  verifyMaintenance?: (db: D1Database, input: StorageMigrationApplyInput, action: "apply" | "reconcile") => Promise<void>;
  inspectPlan?: (env: MigrationEnv, registry: readonly ManagedPortalMigration[]) => Promise<StorageMigrationPreflightReport>;
  loadOperation?: typeof loadMigrationOperation;
  prepareAudit?: typeof prepareMigrationAuditStatement;
  acquireLock?: (db: D1Database, owner: string, options?: PortalMigrationLockOptions) => Promise<boolean>;
  inspectLockedPreflight?: (
    env: MigrationEnv,
    owner: string,
    registry: readonly ManagedPortalMigration[],
  ) => Promise<StorageMigrationPreflightReport>;
  beginOperation?: typeof beginMigrationOperation;
  applyMigration?: typeof applyControlledMigrationWithOwnedLock;
  inspectFinalSchema?: (env: MigrationEnv, registry: readonly ManagedPortalMigration[]) => Promise<boolean>;
  quickCheck?: (env: MigrationEnv) => Promise<StorageQuickCheckResult>;
  completeOperation?: typeof completeMigrationOperation;
  failOperation?: typeof failMigrationOperation;
  markMaintenanceFailed?: (db: D1Database, code: string, now: number) => Promise<void>;
  releaseLock?: (db: D1Database, owner: string) => Promise<void>;
  classifyReconciliation?: (
    env: MigrationEnv,
    row: MigrationOperationRow,
    registry: readonly ManagedPortalMigration[],
  ) => Promise<ReconcileClassification>;
  markInterrupted?: typeof markMigrationInterrupted;
  markReconciled?: typeof markMigrationReconciled;
};

const safeFailureCodes = new Set([
  "migration_apply_failed",
  "migration_apply_verification_failed",
  "migration_apply_lock_lost",
  "migration_apply_audit_unavailable",
]);

export function fail(code: string, status = 503): never {
  throw new StorageMigrationApplyError(code, status);
}

export function safeNow(now: () => number): number {
  const value = Number(now());
  return Number.isSafeInteger(value) && value >= 0 ? value : Date.now();
}

export function safeError(error: unknown, fallback = "migration_apply_failed"): StorageMigrationApplyError {
  if (error instanceof StorageMigrationApplyError) return error;
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (safeFailureCodes.has(code)) return new StorageMigrationApplyError(code, 503);
  return new StorageMigrationApplyError(fallback, fallback === "migration_apply_verification_failed" ? 500 : 503);
}

export function safeReportPlan(
  report: StorageMigrationPreflightReport,
  registry: readonly ManagedPortalMigration[],
): { currentVersion: number; targetVersion: number; pending: readonly ManagedPortalMigration[] } {
  if (report.state === "not_required" || report.pendingMigrationCount === 0) fail("migration_apply_not_required", 409);
  if (report.state !== "ready" || report.decision !== "allow") {
    fail("migration_apply_preflight_blocked", report.state === "unavailable" ? 503 : 422);
  }
  const currentVersion = report.schema.currentVersion;
  const targetVersion = report.schema.latestVersion;
  if (!Number.isSafeInteger(currentVersion) || !Number.isSafeInteger(targetVersion) || targetVersion <= currentVersion) {
    fail("migration_apply_registry_invalid", 503);
  }
  if (registry.some((migration) => migration.version > currentVersion && migration.mode === "automatic")) {
    fail("migration_apply_registry_invalid", 503);
  }
  const appliedVersions = registry.filter((item) => item.version <= currentVersion).map((item) => item.version);
  const pending = controlledPendingMigrations(registry, appliedVersions);
  if (!pending.length || pending.length !== report.pendingMigrationCount || pending.at(-1)?.version !== targetVersion) {
    fail("migration_apply_registry_invalid", 503);
  }
  return { currentVersion, targetVersion, pending };
}

export async function defaultVerifyMaintenance(
  db: D1Database,
  input: StorageMigrationApplyInput,
  action: "apply" | "reconcile",
): Promise<void> {
  const row = await loadMaintenanceState(db).catch(() => null);
  const allowed = action === "apply" ? row?.state === "active" : row?.state === "active" || row?.state === "failed";
  if (!row || !allowed || row.operationId !== input.maintenanceOperationId || !row.controllerSecretHash) {
    fail("migration_apply_maintenance_required", 409);
  }
  if (!await verifyMaintenanceControllerSecret(row.controllerSecretHash, input.controllerSecret)) {
    fail("migration_apply_controller_invalid", 409);
  }
}

export async function prepareMigrationAuditStatement(
  db: D1Database,
  action: string,
  context: StorageMigrationApplyContext,
  values: {
    outcome: "pending" | "success" | "failure";
    operationId?: string;
    schemaVersion?: number;
    errorCode?: string;
    metadata?: Record<string, unknown>;
  },
  now = Date.now(),
): Promise<AuditStatement> {
  if (!db || typeof db.prepare !== "function") fail("migration_apply_audit_unavailable", 503);
  const audit = createAuditContext(context.actor, context.correlationId);
  const allowed = new Set([
    "storage.migration.apply.started",
    "storage.migration.apply.progress",
    "storage.migration.apply.completed",
    "storage.migration.apply.failed",
    "storage.migration.reconcile.interrupted",
    "storage.migration.reconcile.completed",
    "storage.migration.reconcile.failed",
  ]);
  if (!allowed.has(action)) fail("migration_apply_audit_unavailable", 503);
  return db.prepare(`INSERT INTO portal_audit_events (
    id, created_at, correlation_id, actor_identity, actor_role, actor_groups_json,
    action, resource_type, resource_id, event_id, schema_version, approval_id,
    run_id, job_id, outcome, error_code, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'portal-storage-migration', ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(), safeNow(() => now), audit.correlationId,
      audit.actor.identity, audit.actor.role, JSON.stringify(audit.actor.groups),
      action, values.operationId ?? null,
      values.schemaVersion === undefined ? null : String(values.schemaVersion),
      values.outcome, values.errorCode ?? null,
      JSON.stringify(sanitizeAuditMetadata(values.metadata ?? {})),
    );
}

export async function defaultInspectPlan(
  env: MigrationEnv,
  registry: readonly ManagedPortalMigration[],
): Promise<StorageMigrationPreflightReport> {
  return inspectStorageMigrationPreflight(env, { registry });
}

export async function defaultLockedPreflight(
  env: MigrationEnv,
  owner: string,
  registry: readonly ManagedPortalMigration[],
): Promise<StorageMigrationPreflightReport> {
  return inspectStorageMigrationPreflightWithOwnedLock(env, owner, { registry });
}

export async function defaultFinalSchema(
  env: MigrationEnv,
  registry: readonly ManagedPortalMigration[],
): Promise<boolean> {
  const status = await inspectPortalSchemaWithManagedRegistry(env, registry);
  return status.state === "ready" && status.currentVersion === (registry.at(-1)?.version ?? 0);
}

export async function defaultMarkMaintenanceFailed(db: D1Database, _code: string, now: number): Promise<void> {
  await db.prepare(`UPDATE portal_maintenance_state
    SET state = 'failed', updated_at = ?, completed_at = ?, failure_code = 'maintenance_transition_failed'
    WHERE id = 'main' AND state IN ('active', 'verifying', 'exiting')`)
    .bind(now, now).run();
}

export async function defaultClassifyReconciliation(
  env: MigrationEnv,
  row: MigrationOperationRow,
  registry: readonly ManagedPortalMigration[],
): Promise<ReconcileClassification> {
  const schema = await inspectPortalSchemaWithManagedRegistry(env, registry).catch(() => null);
  const quick = await inspectStorageQuickCheck(env).catch(() => ({ state: "unavailable" as const }));
  if (!schema || quick.state !== "healthy") return { state: "failed", code: "migration_reconcile_restore_required" };
  if (schema.state === "ready" && schema.currentVersion === row.targetVersion) {
    return { state: "reconciled", appliedCount: row.totalCount };
  }
  if (schema.state === "pending" && schema.currentVersion === row.fromVersion && row.appliedCount === 0) {
    return { state: "interrupted" };
  }
  return { state: "failed", code: "migration_reconcile_restore_required" };
}

export function succeededRow(row: MigrationOperationRow, now: number): MigrationOperationRow {
  return { ...row, state: "succeeded", appliedCount: row.totalCount, updatedAt: now, completedAt: now, failureCode: null, recoveryRequired: false };
}

export function reconciledRow(row: MigrationOperationRow, now: number): MigrationOperationRow {
  return { ...row, state: "reconciled", appliedCount: row.totalCount, updatedAt: now, completedAt: now, failureCode: null, recoveryRequired: false };
}

export function interruptedRow(row: MigrationOperationRow, now: number): MigrationOperationRow {
  return { ...row, state: "interrupted", updatedAt: now, completedAt: now, failureCode: null, recoveryRequired: false };
}

export function failedRow(row: MigrationOperationRow, now: number, code: string): MigrationOperationRow {
  return { ...row, state: "failed", updatedAt: now, completedAt: now, failureCode: code, recoveryRequired: true };
}

export async function inspectMigrationApplyStatus(env: MigrationEnv): Promise<PublicMigrationOperation> {
  if (!env.DB) fail("migration_apply_database_unavailable", 503);
  const row = await loadMigrationOperation(env.DB).catch(() => fail("migration_operation_unavailable", 503));
  return row ? publicMigrationOperation(row) : publicIdleMigrationOperation();
}

export const defaultRegistry = portalMigrationsV4;
