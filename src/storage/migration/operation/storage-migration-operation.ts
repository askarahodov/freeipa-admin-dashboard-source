export type StoredMigrationOperationState = "running" | "succeeded" | "failed" | "interrupted" | "reconciled";
export type PublicMigrationOperationState = StoredMigrationOperationState | "idle";

export type MigrationOperationRow = {
  operationId: string;
  maintenanceOperationId: string;
  fromVersion: number;
  targetVersion: number;
  totalCount: number;
  appliedCount: number;
  state: StoredMigrationOperationState;
  createdAt: number;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  failureCode: string | null;
  recoveryRequired: boolean;
};

export type PublicMigrationOperation = {
  contractVersion: "1";
  state: PublicMigrationOperationState;
  operationId: string | null;
  fromVersion: number;
  currentVersion: number;
  targetVersion: number;
  totalCount: number;
  appliedCount: number;
  createdAt: number | null;
  startedAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  failureCode: string | null;
  recoveryRequired: boolean;
  correlationId: string | null;
};

const operationIdPattern = /^migration_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maintenanceIdPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set<StoredMigrationOperationState>(["running", "succeeded", "failed", "interrupted", "reconciled"]);
const failureCodes = new Set([
  "migration_apply_failed",
  "migration_apply_execution_failed",
  "migration_apply_progress_failed",
  "migration_apply_verification_failed",
  "migration_apply_audit_failed",
  "migration_apply_lock_lost",
  "migration_apply_release_failed",
  "migration_reconcile_failed",
  "migration_reconcile_restore_required",
  "migration_recovery_required",
]);

export class MigrationOperationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 503) {
    super(code);
    this.name = "MigrationOperationError";
    this.code = code;
    this.status = status;
  }
}

function fail(code = "migration_operation_unavailable", status = 503): never {
  throw new MigrationOperationError(code, status);
}

function safeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail();
  return number;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return safeInteger(value);
}

function safeOperationId(value: unknown): string {
  if (typeof value !== "string" || !operationIdPattern.test(value)) fail();
  return value;
}

function safeMaintenanceId(
  value: unknown,
  code = "migration_operation_unavailable",
  status = 503,
): string {
  if (typeof value !== "string" || !maintenanceIdPattern.test(value)) fail(code, status);
  return value;
}

export function createMigrationOperationId(uuid: () => string = crypto.randomUUID): string {
  const value = `migration_${uuid()}`;
  return safeOperationId(value);
}

export function migrationApplyConfirmation(
  maintenanceOperationId: unknown,
  fromVersion: unknown,
  targetVersion: unknown,
): string {
  const maintenanceId = safeMaintenanceId(maintenanceOperationId, "migration_apply_request_invalid", 400);
  let from: number;
  let target: number;
  try {
    from = safeInteger(fromVersion, 0, 1000);
    target = safeInteger(targetVersion, from, 1000);
  } catch {
    fail("migration_apply_request_invalid", 400);
  }
  return `APPLY:${maintenanceId}:${from}:${target}`;
}

export function normalizeMigrationOperationRow(value: unknown): MigrationOperationRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as Record<string, unknown>;
  if (row.id !== "main") fail();
  const operationId = safeOperationId(row.operation_id ?? row.operationId);
  const maintenanceOperationId = safeMaintenanceId(row.maintenance_operation_id ?? row.maintenanceOperationId);
  const fromVersion = safeInteger(row.from_version ?? row.fromVersion, 0, 1000);
  const targetVersion = safeInteger(row.target_version ?? row.targetVersion, fromVersion, 1000);
  const totalCount = safeInteger(row.total_count ?? row.totalCount, 0, 1000);
  const appliedCount = safeInteger(row.applied_count ?? row.appliedCount, 0, totalCount);
  const stateValue = row.state;
  if (typeof stateValue !== "string" || !states.has(stateValue as StoredMigrationOperationState)) fail();
  const state = stateValue as StoredMigrationOperationState;
  const createdAt = safeInteger(row.created_at ?? row.createdAt);
  const startedAt = safeInteger(row.started_at ?? row.startedAt);
  const updatedAt = safeInteger(row.updated_at ?? row.updatedAt);
  const completedAt = nullableInteger(row.completed_at ?? row.completedAt);
  const rawFailure = row.failure_code ?? row.failureCode;
  const failureCode = rawFailure === null || rawFailure === undefined
    ? null
    : typeof rawFailure === "string" && failureCodes.has(rawFailure) ? rawFailure : fail();
  if (state === "running" && (completedAt !== null || failureCode !== null)) fail();
  if ((state === "succeeded" || state === "reconciled") && (completedAt === null || failureCode !== null || appliedCount !== totalCount)) fail();
  if ((state === "failed" || state === "interrupted") && completedAt === null) fail();
  const normalized = {
    operationId,
    fromVersion,
    targetVersion,
    totalCount,
    appliedCount,
    state,
    createdAt,
    startedAt,
    updatedAt,
    completedAt,
    failureCode,
    recoveryRequired: state === "running" || state === "failed",
  } as MigrationOperationRow;
  Object.defineProperty(normalized, "maintenanceOperationId", {
    value: maintenanceOperationId,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return normalized;
}

export function publicIdleMigrationOperation(): PublicMigrationOperation {
  return {
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
  };
}

export function publicMigrationOperation(
  row: MigrationOperationRow,
  correlationId: string | null = null,
): PublicMigrationOperation {
  return {
    contractVersion: "1",
    state: row.state,
    operationId: row.operationId,
    fromVersion: row.fromVersion,
    currentVersion: row.fromVersion + row.appliedCount,
    targetVersion: row.targetVersion,
    totalCount: row.totalCount,
    appliedCount: row.appliedCount,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    failureCode: row.failureCode,
    recoveryRequired: row.recoveryRequired,
    correlationId: typeof correlationId === "string" && /^cor_[a-z0-9]{20,92}$/i.test(correlationId) ? correlationId : null,
  };
}
