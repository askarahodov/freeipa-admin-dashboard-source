import type { PortalBackupDomain } from "./backup-manifest.ts";
import {
  BackupSelectiveRestorePolicyError,
  validateSelectiveRestoreDomains,
} from "./backup-selective-restore-policy.ts";
import type { RestoreStageOperation } from "./backup-restore-stage.ts";

export type RestoreStageStatus = "prepared" | "committing" | "cancelled" | "committed" | "expired";

export class BackupRestoreStageRepositoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupRestoreStageRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export type RestoreStageRecord = {
  id: string;
  operation: RestoreStageOperation;
  actorIdentity: string;
  selectedDomains: PortalBackupDomain[];
  stageSecretHash: string;
  sourceBindingHash: string;
  recoveryBindingHash: string;
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  status: RestoreStageStatus;
  createdAt: number;
  expiresAt: number;
  completedAt: number | null;
};

export type CreateRestoreStageInput = Omit<RestoreStageRecord, "status" | "completedAt">;

type StageRow = {
  id: unknown;
  operation: unknown;
  actor_identity: unknown;
  selected_domains_json: unknown;
  stage_secret_hash: unknown;
  source_binding_hash: unknown;
  recovery_binding_hash: unknown;
  source_schema_version: unknown;
  current_schema_version: unknown;
  status: unknown;
  created_at: unknown;
  expires_at: unknown;
  completed_at: unknown;
};

type CancelRestoreStageInput = {
  id: string;
  actorIdentity: string;
  stageSecretHash: string;
  now: number;
};

const idPattern = /^restore_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;
const statuses = new Set<RestoreStageStatus>(["prepared", "committing", "cancelled", "committed", "expired"]);
const selectSql = "SELECT id, operation, actor_identity, selected_domains_json, stage_secret_hash, source_binding_hash, recovery_binding_hash, source_schema_version, current_schema_version, status, created_at, expires_at, completed_at FROM portal_backup_restore_stages WHERE id = ?";

function fail(code = "backup_restore_stage_invalid", status = 409, message = "Backup restore stage is invalid"): never {
  throw new BackupRestoreStageRepositoryError(code, status, message);
}

function integer(value: unknown, minimum = 0): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) fail();
  return number;
}

function actor(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 320) fail();
  return normalized;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !hashPattern.test(value)) fail();
  return value;
}

function stageId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) fail();
  return value;
}

function operation(value: unknown): RestoreStageOperation {
  if (value !== "restore" && value !== "rollback") fail();
  return value;
}

function statusValue(value: unknown): RestoreStageStatus {
  if (typeof value !== "string" || !statuses.has(value as RestoreStageStatus)) fail();
  return value as RestoreStageStatus;
}

function selectedDomains(value: unknown): PortalBackupDomain[] {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    fail();
  }
  try {
    return validateSelectiveRestoreDomains(parsed).selectedDomains;
  } catch (error) {
    if (error instanceof BackupSelectiveRestorePolicyError) fail();
    throw error;
  }
}

function resultChanges(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const result = value as { meta?: { changes?: unknown }; changes?: unknown };
  return Number(result.meta?.changes ?? result.changes ?? 0);
}

function normalizeRow(row: StageRow | null): RestoreStageRecord | null {
  if (!row) return null;
  const completedAt = row.completed_at == null ? null : integer(row.completed_at, 0);
  return {
    id: stageId(row.id),
    operation: operation(row.operation),
    actorIdentity: actor(row.actor_identity),
    selectedDomains: selectedDomains(row.selected_domains_json),
    stageSecretHash: hash(row.stage_secret_hash),
    sourceBindingHash: hash(row.source_binding_hash),
    recoveryBindingHash: hash(row.recovery_binding_hash),
    sourceSchemaVersion: integer(row.source_schema_version, 1),
    currentSchemaVersion: integer(row.current_schema_version, 1),
    status: statusValue(row.status),
    createdAt: integer(row.created_at, 1),
    expiresAt: integer(row.expires_at, 1),
    completedAt,
  };
}

function validateCreateInput(input: CreateRestoreStageInput): CreateRestoreStageInput {
  const normalized = {
    id: stageId(input.id),
    operation: operation(input.operation),
    actorIdentity: actor(input.actorIdentity),
    selectedDomains: validateSelectiveRestoreDomains(input.selectedDomains).selectedDomains,
    stageSecretHash: hash(input.stageSecretHash),
    sourceBindingHash: hash(input.sourceBindingHash),
    recoveryBindingHash: hash(input.recoveryBindingHash),
    sourceSchemaVersion: integer(input.sourceSchemaVersion, 1),
    currentSchemaVersion: integer(input.currentSchemaVersion, 1),
    createdAt: integer(input.createdAt, 1),
    expiresAt: integer(input.expiresAt, 1),
  };
  if (normalized.expiresAt <= normalized.createdAt) fail();
  return normalized;
}

export async function createRestoreStage(
  db: D1Database,
  inputValue: CreateRestoreStageInput,
): Promise<RestoreStageRecord> {
  const input = validateCreateInput(inputValue);
  try {
    const result = await db.prepare(
      "INSERT INTO portal_backup_restore_stages (id, operation, actor_identity, selected_domains_json, stage_secret_hash, source_binding_hash, recovery_binding_hash, source_schema_version, current_schema_version, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
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
    ).run();
    if (resultChanges(result) !== 1) fail();
    return { ...input, status: "prepared", completedAt: null };
  } catch (error) {
    if (error instanceof BackupRestoreStageRepositoryError) throw error;
    fail();
  }
}

export async function loadRestoreStage(db: D1Database, idValue: unknown): Promise<RestoreStageRecord | null> {
  const id = stageId(idValue);
  try {
    const row = await db.prepare(selectSql).bind(id).first<StageRow>();
    return normalizeRow(row ?? null);
  } catch (error) {
    if (error instanceof BackupRestoreStageRepositoryError) throw error;
    fail();
  }
}

export async function cancelRestoreStage(
  db: D1Database,
  input: CancelRestoreStageInput,
): Promise<{ cancelled: true; status: "cancelled" }> {
  const id = stageId(input.id);
  const actorIdentity = actor(input.actorIdentity);
  const stageSecretHash = hash(input.stageSecretHash);
  const now = integer(input.now, 1);
  try {
    const result = await db.prepare(
      "UPDATE portal_backup_restore_stages SET status = 'cancelled', completed_at = ? WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'prepared' AND expires_at > ?",
    ).bind(now, id, actorIdentity, stageSecretHash, now).run();
    if (resultChanges(result) === 1) return { cancelled: true, status: "cancelled" };

    const stage = await loadRestoreStage(db, id);
    if (!stage || stage.actorIdentity !== actorIdentity || stage.stageSecretHash !== stageSecretHash) {
      fail("backup_restore_stage_invalid", 409, "Backup restore stage is invalid");
    }
    if (stage.status === "cancelled") {
      fail("backup_restore_stage_cancelled", 409, "Backup restore stage was cancelled");
    }
    if (stage.status === "committed" || stage.status === "committing") {
      fail("backup_restore_stage_committed", 409, "Backup restore stage was already committed");
    }
    if (stage.status === "expired" || stage.expiresAt <= now) {
      fail("backup_restore_stage_expired", 409, "Backup restore stage expired");
    }
    fail();
  } catch (error) {
    if (error instanceof BackupRestoreStageRepositoryError) throw error;
    fail();
  }
}
