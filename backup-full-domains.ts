import { canonicalBackupJson, PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "./backup-manifest.ts";
import { BackupExportError, type BackupExportEnv } from "./backup-export.ts";

export class FullBackupValidationError extends Error {
  readonly code = "backup_full_payload_invalid";
  readonly status = 422;
  constructor(message = "Full backup payload is invalid") { super(message); this.name = "FullBackupValidationError"; }
}

export type FullBackupTable = {
  name: string;
  columns: string[];
  primaryKey: string[];
  rows: unknown[][];
};

export type FullBackupDomainPayload = {
  domain: PortalBackupDomain;
  schemaVersion: number;
  tables: FullBackupTable[];
};

export type FullBackupDomainExporter = {
  domain: PortalBackupDomain;
  path: `domains/${string}.json`;
  export(env: BackupExportEnv, schemaVersion: number): Promise<{ payload: FullBackupDomainPayload; records: number }>;
};

export type FullBackupTableDefinition = {
  name: string;
  sourceTable: string;
  columns: readonly string[];
  primaryKey: readonly string[];
  sql: string;
};

function definition(name: string, columns: readonly string[], primaryKey: readonly string[], sourceTable = name): FullBackupTableDefinition {
  return {
    name,
    sourceTable,
    columns,
    primaryKey,
    sql: `SELECT ${columns.join(", ")} FROM ${sourceTable} ORDER BY ${primaryKey.join(", ")}`,
  };
}

const settings = [
  definition("app_settings", ["id", "config_json", "encrypted_secrets", "updated_at"], ["id"]),
  definition("portal_settings_drafts", ["id", "base_revision", "changes_json", "encrypted_secrets", "status", "validation_json", "created_by", "created_at", "updated_at", "validated_at", "applied_at"], ["id"]),
  definition("portal_settings_apply_commits", ["id", "draft_id", "revision", "config_json", "encrypted_secrets", "created_at"], ["id"]),
  definition("portal_settings_revisions", ["id", "revision", "config_json", "encrypted_secrets", "source_draft_id", "created_by", "reason", "status", "health_json", "created_at"], ["id"]),
  definition("portal_settings_draft_resets", ["draft_id", "reset_fields_json", "created_at"], ["draft_id"]),
] as const;

const localAuth = [
  definition("portal_users", ["id", "username", "display_name", "password_hash", "password_salt", "password_iterations", "role", "disabled", "failed_attempts", "locked_until", "created_at", "updated_at", "last_login_at"], ["id"]),
  definition("portal_sessions", ["id", "user_id", "token_hash", "created_at", "last_seen_at", "expires_at", "user_agent"], ["id"]),
] as const;

const rbac = [
  definition("portal_role_assignments", ["id", "username", "role", "disabled", "updated_at"], ["id"], "portal_users"),
] as const;

const policies = [
  definition("catalog_visibility_policies", ["id", "policy_json", "updated_at"], ["id"]),
  definition("approval_policy_sets", ["id", "policy_json", "updated_at"], ["id"]),
  definition("process_presentation_sets", ["id", "metadata_json", "updated_at"], ["id"]),
] as const;

const catalog = [
  definition("xyops_catalog_snapshot", ["id", "catalog_json", "synced_at"], ["id"]),
  definition("xyops_catalog_history", ["id", "synced_at", "changes_json", "catalog_json"], ["id"]),
  definition("xyops_catalog_sync_runs", ["id", "trigger_name", "status", "started_at", "completed_at", "process_count", "change_count", "error"], ["id"]),
] as const;

const operations = [
  definition("operation_runs", ["id", "job_id", "event_id", "title", "kind", "mode", "status", "actor", "subject", "error", "stages_json", "started_at", "updated_at", "completed_at"], ["id"]),
  definition("operation_run_results", ["run_id", "job_id", "summary", "values_json", "links_json", "files_json", "table_json", "truncated", "captured_at"], ["run_id"]),
  definition("operation_run_replays", ["run_id", "event_id", "schema_version", "encrypted_spec", "replayable", "reason", "parent_run_id", "created_at"], ["run_id"]),
  definition("operation_notifications", ["id", "run_id", "status", "title", "message", "created_at"], ["id"]),
  definition("operation_notification_reads", ["notification_id", "identity", "read_at"], ["notification_id", "identity"]),
] as const;

const approvals = [
  definition("operation_approvals", ["id", "event_id", "title", "category", "schema_version", "requester_identity", "requester_role", "requester_groups_json", "status", "required_approvals", "approver_roles_json", "approver_groups_json", "requester_cannot_approve", "rule_id", "summary_json", "encrypted_spec", "request_fingerprint", "expires_at", "created_at", "updated_at", "approved_at", "executed_at", "run_id", "parent_run_id", "error"], ["id"]),
  definition("operation_approval_decisions", ["approval_id", "approver_identity", "approver_role", "decision", "comment", "decided_at"], ["approval_id", "approver_identity"]),
] as const;

const audit = [
  definition("portal_audit_events", ["id", "created_at", "correlation_id", "actor_identity", "actor_role", "actor_groups_json", "action", "resource_type", "resource_id", "event_id", "schema_version", "approval_id", "run_id", "job_id", "outcome", "error_code", "metadata_json"], ["id"]),
] as const;

export const FULL_BACKUP_TABLES: ReadonlyArray<readonly [PortalBackupDomain, readonly FullBackupTableDefinition[]]> = [
  ["settings", settings],
  ["local-auth", localAuth],
  ["rbac", rbac],
  ["policies", policies],
  ["catalog", catalog],
  ["operations", operations],
  ["approvals", approvals],
  ["audit", audit],
];

const tablesByDomain = new Map<PortalBackupDomain, readonly FullBackupTableDefinition[]>(FULL_BACKUP_TABLES);

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function jsonScalar(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

export function validateFullBackupDomainPayload(domain: PortalBackupDomain, value: unknown): FullBackupDomainPayload {
  if (!plainObject(value) || value.domain !== domain || !Number.isSafeInteger(value.schemaVersion) || Number(value.schemaVersion) < 1 || !Array.isArray(value.tables)) {
    throw new FullBackupValidationError();
  }
  const expected = tablesByDomain.get(domain);
  if (!expected || value.tables.length !== expected.length) throw new FullBackupValidationError();
  const tables: FullBackupTable[] = [];
  for (let index = 0; index < expected.length; index += 1) {
    const descriptor = expected[index];
    const table = value.tables[index];
    if (!plainObject(table) || table.name !== descriptor.name || !Array.isArray(table.columns) || !Array.isArray(table.primaryKey) || !Array.isArray(table.rows)) {
      throw new FullBackupValidationError();
    }
    if (!sameArray(table.columns as string[], descriptor.columns) || !sameArray(table.primaryKey as string[], descriptor.primaryKey)) {
      throw new FullBackupValidationError();
    }
    const primaryIndexes = descriptor.primaryKey.map((column) => descriptor.columns.indexOf(column));
    const keys = new Set<string>();
    const rows: unknown[][] = [];
    for (const rawRow of table.rows) {
      if (!Array.isArray(rawRow) || rawRow.length !== descriptor.columns.length || rawRow.some((item) => !jsonScalar(item))) {
        throw new FullBackupValidationError();
      }
      const key = canonicalBackupJson(primaryIndexes.map((position) => rawRow[position]));
      if (keys.has(key)) throw new FullBackupValidationError();
      keys.add(key);
      rows.push([...rawRow]);
    }
    tables.push({ name: descriptor.name, columns: [...descriptor.columns], primaryKey: [...descriptor.primaryKey], rows });
  }
  return { domain, schemaVersion: Number(value.schemaVersion), tables };
}

async function loadTable(env: BackupExportEnv, descriptor: FullBackupTableDefinition): Promise<FullBackupTable> {
  if (!env.DB) throw new BackupExportError("backup_database_unavailable", 503, "Backup database is unavailable");
  try {
    const result = await env.DB.prepare(descriptor.sql).all<Record<string, unknown>>();
    const sourceRows = Array.isArray(result.results) ? result.results : [];
    const rows = sourceRows.map((row) => descriptor.columns.map((column) => {
      if (!Object.hasOwn(row, column) || typeof row[column] === "undefined") {
        throw new BackupExportError("backup_schema_incompatible", 409, "Backup schema is incompatible");
      }
      return row[column];
    }));
    return { name: descriptor.name, columns: [...descriptor.columns], primaryKey: [...descriptor.primaryKey], rows };
  } catch (error) {
    if (error instanceof BackupExportError) throw error;
    throw new BackupExportError("backup_schema_incompatible", 409, "Backup schema is incompatible");
  }
}

function domainExporter(domain: PortalBackupDomain, definitions: readonly FullBackupTableDefinition[]): FullBackupDomainExporter {
  return {
    domain,
    path: `domains/${domain}.json`,
    async export(env, schemaVersion) {
      if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new BackupExportError("backup_schema_incompatible", 409, "Backup schema is incompatible");
      const tables: FullBackupTable[] = [];
      for (const descriptor of definitions) tables.push(await loadTable(env, descriptor));
      const payload = validateFullBackupDomainPayload(domain, { domain, schemaVersion, tables });
      return { payload, records: payload.tables.reduce((total, table) => total + table.rows.length, 0) };
    },
  };
}

const exporters = FULL_BACKUP_TABLES.map(([domain, definitions]) => domainExporter(domain, definitions));
if (exporters.length !== PORTAL_BACKUP_DOMAINS.length || exporters.some((item, index) => item.domain !== PORTAL_BACKUP_DOMAINS[index])) {
  throw new Error("Full backup exporter registry is not exhaustive or canonical");
}

export const FULL_BACKUP_EXPORTERS: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter> = new Map(
  exporters.map((item) => [item.domain, item]),
);
