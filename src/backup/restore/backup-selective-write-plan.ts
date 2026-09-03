import {
  FULL_BACKUP_TABLES,
  validateFullBackupDomainPayload,
  type FullBackupDomainPayload,
  type FullBackupTable,
  type FullBackupTableDefinition,
} from "../export/backup-full-domains.ts";
import {
  canonicalBackupJson,
  type PortalBackupDomain,
} from "../backup-manifest.ts";
import type { SelectiveRestorePolicyResult } from "./backup-selective-restore-policy.ts";

export const MAX_SELECTIVE_RESTORE_JSON_BINDING_BYTES = 1_750_000;
export const MAX_SELECTIVE_RESTORE_CLAIM_PARAMETERS = 100;
export const MAX_SELECTIVE_RESTORE_BATCH_STATEMENTS = 48;
export const MAX_SELECTIVE_RESTORE_SQL_BYTES = 100_000;

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
  rowChunks: string[];
};

const definitionsByDomain = new Map<PortalBackupDomain, readonly FullBackupTableDefinition[]>(FULL_BACKUP_TABLES);
const stageIdPattern = /^restore_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;
const guardedStage = "SELECT 1 FROM portal_backup_restore_stages WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'committing'";
const encoder = new TextEncoder();

function fail(code = "backup_restore_commit_failed", message = "Backup restore commit failed"): never {
  throw new BackupSelectiveWritePlanError(code, 422, message);
}

function tooLarge(): never {
  fail("backup_restore_commit_too_large", "Backup restore candidate exceeds atomic D1 limits");
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

function jsonBytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function chunkRows(rows: readonly unknown[][]): string[] {
  const chunks: string[] = [];
  let rowJson: string[] = [];
  let bytes = 2;
  const flush = () => {
    if (!rowJson.length) return;
    chunks.push(`[${rowJson.join(",")}]`);
    rowJson = [];
    bytes = 2;
  };

  for (const row of rows) {
    const serialized = canonicalBackupJson(row);
    const serializedBytes = jsonBytes(serialized);
    if (serializedBytes + 2 > MAX_SELECTIVE_RESTORE_JSON_BINDING_BYTES) tooLarge();
    const additional = serializedBytes + (rowJson.length ? 1 : 0);
    if (bytes + additional > MAX_SELECTIVE_RESTORE_JSON_BINDING_BYTES) flush();
    rowJson.push(serialized);
    bytes += serializedBytes + (rowJson.length > 1 ? 1 : 0);
  }
  flush();
  return chunks;
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
      output.push({
        domain,
        descriptor: definitions[index],
        payload: payload.tables[index],
        rowChunks: chunkRows(payload.tables[index].rows),
      });
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
  if (jsonBytes(sql) > MAX_SELECTIVE_RESTORE_SQL_BYTES) tooLarge();
  if (values.length > MAX_SELECTIVE_RESTORE_CLAIM_PARAMETERS) tooLarge();
  return db.prepare(sql).bind(...values);
}

function rowProjection(descriptor: FullBackupTableDefinition, source: string): string {
  return descriptor.columns
    .map((_, index) => `json_extract(${source}, '$[${index}]')`)
    .join(", ");
}

function currentStateGuard(table: RestoreTable): { sql: string; values: unknown[] } {
  const columns = table.descriptor.columns.join(", ");
  const projected = rowProjection(table.descriptor, "value");
  return {
    sql: [
      `(SELECT COUNT(*) FROM ${table.descriptor.name}) = ?`,
      ...table.rowChunks.map(() => (
        `NOT EXISTS (SELECT ${projected} FROM json_each(?) EXCEPT SELECT ${columns} FROM ${table.descriptor.name})`
      )),
    ].join(" AND "),
    values: [table.payload.rows.length, ...table.rowChunks],
  };
}

function validateBatchSize(sourceTables: readonly RestoreTable[], claimParameterCount: number): void {
  if (claimParameterCount > MAX_SELECTIVE_RESTORE_CLAIM_PARAMETERS) tooLarge();
  const insertChunks = sourceTables
    .filter((table) => table.descriptor.name !== "portal_sessions")
    .reduce((total, table) => total + table.rowChunks.length, 0);
  const statements = 1 + sourceTables.length + insertChunks + 2;
  if (statements > MAX_SELECTIVE_RESTORE_BATCH_STATEMENTS) tooLarge();
}

export function validateSelectiveRestoreCandidate(
  policy: SelectiveRestorePolicyResult,
  fullPayloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>,
): void {
  if (!policy
      || !Array.isArray(policy.selectedDomains)
      || !Array.isArray(policy.physicalDomains)
      || policy.physicalDomains.includes("audit")
      || policy.physicalDomains.includes("rbac")) fail();
  const tables = restoreTables(policy, fullPayloads);
  if (policy.selectedDomains.includes("local-auth")) requireActiveAdministrator(tables);
  const claimParameters = 5 + tables.reduce((total, table) => total + 1 + table.rowChunks.length, 0);
  validateBatchSize(tables, claimParameters);
}

export function buildSelectiveRestoreStatements(
  db: D1Database,
  guardValue: SelectiveRestoreStageGuard,
  policy: SelectiveRestorePolicyResult,
  sourcePayloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>,
  expectedCurrentPayloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>,
  auditValue: SelectiveRestoreAuditRow,
): D1PreparedStatement[] {
  const guard = validateGuard(guardValue);
  const audit = validateAudit(auditValue);
  validateSelectiveRestoreCandidate(policy, sourcePayloads);
  const sourceTables = restoreTables(policy, sourcePayloads);
  const currentTables = restoreTables(policy, expectedCurrentPayloads);
  if (sourceTables.length !== currentTables.length
      || sourceTables.some((item, index) => item.descriptor.name !== currentTables[index].descriptor.name)) fail();

  const claimGuards = currentTables.map(currentStateGuard);
  const claimSql = [
    "UPDATE portal_backup_restore_stages SET status = 'committing', completed_at = ? WHERE id = ? AND actor_identity = ? AND stage_secret_hash = ? AND status = 'prepared' AND expires_at > ?",
    ...claimGuards.map((item) => `AND ${item.sql}`),
  ].join(" ");
  const claimValues = [
    guard.now,
    guard.id,
    guard.actorIdentity,
    guard.stageSecretHash,
    guard.now,
    ...claimGuards.flatMap((item) => item.values),
  ];
  validateBatchSize(sourceTables, claimValues.length);

  const statements: D1PreparedStatement[] = [prepared(db, claimSql, claimValues)];

  for (const item of [...sourceTables].reverse()) {
    statements.push(prepared(
      db,
      `DELETE FROM ${item.descriptor.name} WHERE EXISTS (${guardedStage})`,
      guardValues(guard),
    ));
  }

  for (const item of sourceTables) {
    if (item.descriptor.name === "portal_sessions") continue;
    for (const rowsJson of item.rowChunks) {
      statements.push(prepared(
        db,
        `INSERT INTO ${item.descriptor.name} (${item.descriptor.columns.join(", ")}) SELECT ${rowProjection(item.descriptor, "value")} FROM json_each(?) WHERE EXISTS (${guardedStage})`,
        [rowsJson, ...guardValues(guard)],
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
