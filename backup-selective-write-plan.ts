import {
  FULL_BACKUP_TABLES,
  validateFullBackupDomainPayload,
  type FullBackupDomainPayload,
  type FullBackupTable,
  type FullBackupTableDefinition,
} from "./backup-full-domains.ts";
import type { PortalBackupDomain } from "./backup-manifest.ts";
import type { SelectiveRestorePolicyResult } from "./backup-selective-restore-policy.ts";

export class BackupSelectiveWritePlanError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupSelectiveWritePlanError";
    this.code = code;
    this.status = status;
  }
}

export type SelectiveRestoreStageGuard = {
  id: string;
  actorIdentity: string;
  stageSecretHash: string;
  now: number;
};

export type SelectiveRestoreAuditRow = {
  id: string;
  createdAt: number;
  correlationId: string;
  actorIdentity: string;
  actorRole: "admin";
  actorGroupsJson: string;
  action: "backup.restore.commit" | "backup.rollback.commit";
  resourceType: "portal_backup";
  resourceId: string;
  schemaVersion: string;
  outcome: "success";
  metadataJson: string;
};

type RestoreTable = {
  domain: PortalBackupDomain;
  descriptor: FullBackupTableDefinition;
  payload: FullBackupTable;
};

const definitionsByDomain = new Map<PortalBackupDomain, readonly FullBackupTableDefinition[]>(FULL_BACKUP_TABLES);
const stageIdPattern = /^restore_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;
const guardedStage = "SELECT 1 FROM portal_backup_restore_stages WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'committing'";

function fail(code = "backup_restore_commit_failed", message = "Backup restore commit failed"): never {
  throw new BackupSelectiveWritePlanError(code, 422, message);
}

function strictText(value: unknown, maximum = 1024): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) fail();
  return normalized;
}

function strictInteger(value: unknown, minimum = 0): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) fail();
  return number;
}

function validateGuard(value: SelectiveRestoreStageGuard): SelectiveRestoreStageGuard {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  if (!stageIdPattern.test(value.id) || !hashPattern.test(value.stageSecretHash)) fail();
  return {
    id: value.id,
    actorIdentity: strictText(value.actorIdentity, 320),
    stageSecretHash: value.stageSecretHash,
    now: strictInteger(value.now, 1),
  };
}

function validateAudit(value: SelectiveRestoreAuditRow): SelectiveRestoreAuditRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  if (value.actorRole !== "admin"
      || (value.action !== "backup.restore.commit" && value.action !== "backup.rollback.commit")
      || value.resourceType !== "portal_backup"
      || value.outcome !== "success") fail();
  for (const jsonValue of [value.actorGroupsJson, value.metadataJson]) {
    try { JSON.parse(jsonValue); } catch { fail(); }
  }
  return {
    id: strictText(value.id, 160),
    createdAt: strictInteger(value.createdAt, 1),
    correlationId: strictText(value.correlationId, 160),
    actorIdentity: strictText(value.actorIdentity, 320),
    actorRole: "admin",
    actorGroupsJson: value.actorGroupsJson,
    action: value.action,
    resourceType: "portal_backup",
    resourceId: strictText(value.resourceId, 160),
    schemaVersion: strictText(value.schemaVersion, 40),
    outcome: "success",
    metadataJson: value.metadataJson,
  };
}

function guardValues(guard: SelectiveRestoreStageGuard): [string, string, string] {
  return [guard.id, guard.actorIdentity, guard.stageSecretHash];
}

function restoreTables(
  policy: SelectiveRestorePolicyResult,
  fullPayloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>,
): RestoreTable[] {
  const output: RestoreTable[] = [];
  for (const domain of policy.physicalDomains) {
    const definitions = definitionsByDomain.get(domain);
    const source = fullPayloads.get(domain);
    if (!definitions || !source) fail();
    const payload = validateFullBackupDomainPayload(domain, source);
    if (payload.tables.length !== definitions.length) fail();
    for (let index = 0; index < definitions.length; index += 1) {
      output.push({ domain, descriptor: definitions[index], payload: payload.tables[index] });
    }
  }
  return output;
}

function requireActiveAdministrator(tables: readonly RestoreTable[]): void {
  const users = tables.find((item) => item.descriptor.name === "portal_users");
  if (!users) fail("backup_restore_admin_required", "Restored local authentication requires an active administrator");
  const roleIndex = users.descriptor.columns.indexOf("role");
  const disabledIndex = users.descriptor.columns.indexOf("disabled");
  if (roleIndex < 0 || disabledIndex < 0 || !users.payload.rows.some((row) => (
    row[roleIndex] === "admin" && Number(row[disabledIndex]) === 0
  ))) {
    fail("backup_restore_admin_required", "Restored local authentication requires an active administrator");
  }
}

function prepared(
  db: D1Database,
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement {
  return db.prepare(sql).bind(...values);
}

export function buildSelectiveRestoreStatements(
  db: D1Database,
  guardValue: SelectiveRestoreStageGuard,
  policy: SelectiveRestorePolicyResult,
  fullPayloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>,
  auditValue: SelectiveRestoreAuditRow,
): D1PreparedStatement[] {
  const guard = validateGuard(guardValue);
  const audit = validateAudit(auditValue);
  if (!policy || !Array.isArray(policy.physicalDomains) || policy.physicalDomains.includes("audit") || policy.physicalDomains.includes("rbac")) fail();
  const tables = restoreTables(policy, fullPayloads);
  if (policy.selectedDomains.includes("local-auth")) requireActiveAdministrator(tables);

  const statements: D1PreparedStatement[] = [];
  statements.push(prepared(
    db,
    "UPDATE portal_backup_restore_stages SET status = 'committing', completed_at = ? WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'prepared' AND expires_at > ?",
    [guard.now, guard.id, guard.actorIdentity, guard.stageSecretHash, guard.now],
  ));

  for (const item of [...tables].reverse()) {
    statements.push(prepared(
      db,
      `DELETE FROM ${item.descriptor.name} WHERE EXISTS (${guardedStage})`,
      guardValues(guard),
    ));
  }

  for (const item of tables) {
    if (item.descriptor.name === "portal_sessions") continue;
    const placeholders = item.descriptor.columns.map(() => "?").join(", ");
    for (const row of item.payload.rows) {
      statements.push(prepared(
        db,
        `INSERT INTO ${item.descriptor.name} (${item.descriptor.columns.join(", ")}) SELECT ${placeholders} WHERE EXISTS (${guardedStage})`,
        [...row, ...guardValues(guard)],
      ));
    }
  }

  statements.push(prepared(
    db,
    `INSERT INTO portal_audit_events (id, created_at, correlation_id, actor_identity, actor_role, actor_groups_json, action, resource_type, resource_id, event_id, schema_version, approval_id, run_id, job_id, outcome, error_code, metadata_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, NULL, ? WHERE EXISTS (${guardedStage})`,
    [
      audit.id,
      audit.createdAt,
      audit.correlationId,
      audit.actorIdentity,
      audit.actorRole,
      audit.actorGroupsJson,
      audit.action,
      audit.resourceType,
      audit.resourceId,
      audit.schemaVersion,
      audit.outcome,
      audit.metadataJson,
      ...guardValues(guard),
    ],
  ));
  statements.push(prepared(
    db,
    "UPDATE portal_backup_restore_stages SET status = 'committed', completed_at = ? WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'committing'",
    [guard.now, guard.id, guard.actorIdentity, guard.stageSecretHash],
  ));
  return statements;
}
