import {
  IsolatedRestoreStore,
  type IsolatedRestoreTable,
} from "./backup-isolated-store.ts";
import type { PortalBackupDomain } from "./backup-manifest.ts";

export class BackupIsolatedVerificationError extends Error {
  readonly code = "backup_test_restore_failed";
  readonly status = 422;

  constructor(message = "Backup test restore consistency check failed") {
    super(message);
    this.name = "BackupIsolatedVerificationError";
  }
}

export type IsolatedRestorePreviewGate = {
  canRestore: boolean;
  requiredMigrations: number[];
  summary: { conflict: number };
};

export type IsolatedRestoreVerificationOptions = {
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  preview: IsolatedRestorePreviewGate;
};

export type IsolatedRestoreDomainVerification = {
  domain: PortalBackupDomain;
  tables: number;
  records: number;
  checks: string[];
  warnings: string[];
};

export type IsolatedRestoreVerificationResult = {
  canCommit: boolean;
  summary: {
    tables: number;
    records: number;
    checks: number;
    warnings: number;
  };
  domains: IsolatedRestoreDomainVerification[];
};

const MAX_WARNINGS = 20;
const roles = new Set(["viewer", "operator", "admin"]);

function fail(): never {
  throw new BackupIsolatedVerificationError();
}

function column(table: IsolatedRestoreTable, name: string): number {
  const index = table.columns.indexOf(name);
  if (index < 0) fail();
  return index;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function jsonValue(value: unknown, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length === 0) fail();
  try {
    JSON.parse(value);
  } catch {
    fail();
  }
}

function validateJsonColumns(
  table: IsolatedRestoreTable | null,
  fields: Array<{ name: string; nullable?: boolean }>,
): void {
  if (!table) return;
  const indexes = fields.map((field) => ({ ...field, index: column(table, field.name) }));
  for (const row of table.rows) {
    for (const field of indexes) jsonValue(row[field.index], field.nullable ?? false);
  }
}

function table(store: IsolatedRestoreStore, domain: PortalBackupDomain, name: string): IsolatedRestoreTable | null {
  return store.getTable(domain, name);
}

function validateDomainJson(store: IsolatedRestoreStore, domain: PortalBackupDomain): boolean {
  switch (domain) {
    case "settings":
      validateJsonColumns(table(store, domain, "app_settings"), [{ name: "config_json" }]);
      validateJsonColumns(table(store, domain, "portal_settings_drafts"), [
        { name: "changes_json" }, { name: "validation_json" },
      ]);
      validateJsonColumns(table(store, domain, "portal_settings_apply_commits"), [{ name: "config_json" }]);
      validateJsonColumns(table(store, domain, "portal_settings_revisions"), [
        { name: "config_json" }, { name: "health_json" },
      ]);
      validateJsonColumns(table(store, domain, "portal_settings_draft_resets"), [{ name: "reset_fields_json" }]);
      return true;
    case "policies":
      validateJsonColumns(table(store, domain, "catalog_visibility_policies"), [{ name: "policy_json" }]);
      validateJsonColumns(table(store, domain, "approval_policy_sets"), [{ name: "policy_json" }]);
      validateJsonColumns(table(store, domain, "process_presentation_sets"), [{ name: "metadata_json" }]);
      return true;
    case "catalog":
      validateJsonColumns(table(store, domain, "xyops_catalog_snapshot"), [{ name: "catalog_json" }]);
      validateJsonColumns(table(store, domain, "xyops_catalog_history"), [
        { name: "changes_json" }, { name: "catalog_json" },
      ]);
      return true;
    case "operations":
      validateJsonColumns(table(store, domain, "operation_runs"), [{ name: "stages_json" }]);
      validateJsonColumns(table(store, domain, "operation_run_results"), [
        { name: "values_json" }, { name: "links_json" }, { name: "files_json" }, { name: "table_json", nullable: true },
      ]);
      return true;
    case "approvals":
      validateJsonColumns(table(store, domain, "operation_approvals"), [
        { name: "requester_groups_json" },
        { name: "approver_roles_json" },
        { name: "approver_groups_json" },
        { name: "summary_json" },
      ]);
      return true;
    case "audit":
      validateJsonColumns(table(store, domain, "portal_audit_events"), [
        { name: "actor_groups_json" }, { name: "metadata_json" },
      ]);
      return true;
    case "local-auth":
    case "rbac":
      return false;
  }
}

function validateLocalAuth(store: IsolatedRestoreStore): Map<string, { role: string; disabled: unknown }> {
  const users = table(store, "local-auth", "portal_users");
  const sessions = table(store, "local-auth", "portal_sessions");
  if (!users || !sessions) fail();
  const userId = column(users, "id");
  const passwordHash = column(users, "password_hash");
  const passwordSalt = column(users, "password_salt");
  const iterations = column(users, "password_iterations");
  const role = column(users, "role");
  const disabled = column(users, "disabled");
  const indexed = new Map<string, { role: string; disabled: unknown }>();
  for (const row of users.rows) {
    if (!nonEmptyString(row[userId])
        || !nonEmptyString(row[passwordHash])
        || !nonEmptyString(row[passwordSalt])
        || !safeInteger(row[iterations], 210000)
        || !nonEmptyString(row[role])
        || !roles.has(row[role])
        || (row[disabled] !== 0 && row[disabled] !== 1)) {
      fail();
    }
    indexed.set(row[userId], { role: row[role], disabled: row[disabled] });
  }
  const sessionUser = column(sessions, "user_id");
  const tokenHash = column(sessions, "token_hash");
  for (const row of sessions.rows) {
    if (!nonEmptyString(row[sessionUser])
        || !indexed.has(row[sessionUser])
        || !nonEmptyString(row[tokenHash])) {
      fail();
    }
  }
  return indexed;
}

function validateRbac(
  store: IsolatedRestoreStore,
  users: Map<string, { role: string; disabled: unknown }> | null,
): string[] {
  const assignments = table(store, "rbac", "portal_role_assignments");
  if (!assignments) fail();
  if (!users) return ["dependency_not_selected:local-auth"];
  const id = column(assignments, "id");
  const role = column(assignments, "role");
  const disabled = column(assignments, "disabled");
  for (const row of assignments.rows) {
    if (!nonEmptyString(row[id])) fail();
    const user = users.get(row[id]);
    if (!user || user.role !== row[role] || user.disabled !== row[disabled]) fail();
  }
  return [];
}

function values(tableValue: IsolatedRestoreTable | null, field: string): Set<string> {
  if (!tableValue) fail();
  const index = column(tableValue, field);
  const result = new Set<string>();
  for (const row of tableValue.rows) {
    if (!nonEmptyString(row[index])) fail();
    result.add(row[index]);
  }
  return result;
}

function validateSettings(store: IsolatedRestoreStore): void {
  const drafts = table(store, "settings", "portal_settings_drafts");
  const commits = table(store, "settings", "portal_settings_apply_commits");
  const revisions = table(store, "settings", "portal_settings_revisions");
  const resets = table(store, "settings", "portal_settings_draft_resets");
  const draftIds = values(drafts, "id");
  if (!commits || !revisions || !resets) fail();
  const commitDraft = column(commits, "draft_id");
  const commitRevision = column(commits, "revision");
  for (const row of commits.rows) {
    if (!nonEmptyString(row[commitDraft]) || !draftIds.has(row[commitDraft]) || !safeInteger(row[commitRevision], 1)) fail();
  }
  const revision = column(revisions, "revision");
  const sourceDraft = column(revisions, "source_draft_id");
  for (const row of revisions.rows) {
    if (!safeInteger(row[revision], 1)) fail();
    if (row[sourceDraft] !== null && (!nonEmptyString(row[sourceDraft]) || !draftIds.has(row[sourceDraft]))) fail();
  }
  const resetDraft = column(resets, "draft_id");
  for (const row of resets.rows) {
    if (!nonEmptyString(row[resetDraft]) || !draftIds.has(row[resetDraft])) fail();
  }
}

function validateReferences(
  child: IsolatedRestoreTable | null,
  childField: string,
  parents: Set<string>,
): void {
  if (!child) fail();
  const index = column(child, childField);
  for (const row of child.rows) {
    if (!nonEmptyString(row[index]) || !parents.has(row[index])) fail();
  }
}

function validateOperations(store: IsolatedRestoreStore): void {
  const runs = values(table(store, "operations", "operation_runs"), "id");
  validateReferences(table(store, "operations", "operation_run_results"), "run_id", runs);
  validateReferences(table(store, "operations", "operation_run_replays"), "run_id", runs);
  validateReferences(table(store, "operations", "operation_notifications"), "run_id", runs);
  const notifications = values(table(store, "operations", "operation_notifications"), "id");
  validateReferences(table(store, "operations", "operation_notification_reads"), "notification_id", notifications);
}

function validateApprovals(store: IsolatedRestoreStore): void {
  const approvals = values(table(store, "approvals", "operation_approvals"), "id");
  validateReferences(table(store, "approvals", "operation_approval_decisions"), "approval_id", approvals);
}

function safeWarnings(values: string[]): string[] {
  return [...new Set(values)].sort().slice(0, MAX_WARNINGS);
}

export function verifyIsolatedRestore(
  store: IsolatedRestoreStore,
  options: IsolatedRestoreVerificationOptions,
): IsolatedRestoreVerificationResult {
  try {
    if (!safeInteger(options.sourceSchemaVersion, 1)
        || !safeInteger(options.currentSchemaVersion, 1)
        || options.sourceSchemaVersion > options.currentSchemaVersion
        || !options.preview
        || typeof options.preview.canRestore !== "boolean"
        || !Array.isArray(options.preview.requiredMigrations)
        || !safeInteger(options.preview.summary?.conflict, 0)) {
      fail();
    }

    const selectedDomains = store.selectedDomains();
    let stagedUsers: Map<string, { role: string; disabled: unknown }> | null = null;
    if (selectedDomains.includes("local-auth")) stagedUsers = validateLocalAuth(store);

    const domains: IsolatedRestoreDomainVerification[] = [];
    for (const domain of selectedDomains) {
      const summary = store.domainSummary(domain);
      const checks = ["table-contract", "record-count", "primary-keys"];
      const warnings: string[] = [];
      if (validateDomainJson(store, domain)) checks.push("json-fields");
      switch (domain) {
        case "local-auth":
          checks.push("local-auth-integrity");
          break;
        case "rbac":
          warnings.push(...validateRbac(store, stagedUsers));
          if (stagedUsers) checks.push("rbac-consistency");
          break;
        case "settings":
          validateSettings(store);
          checks.push("settings-consistency");
          break;
        case "operations":
          validateOperations(store);
          checks.push("operation-references");
          break;
        case "approvals":
          validateApprovals(store);
          checks.push("approval-references");
          break;
        case "policies":
        case "catalog":
        case "audit":
          break;
      }
      domains.push({
        domain,
        tables: summary.tables,
        records: summary.records,
        checks: [...new Set(checks)].sort(),
        warnings: safeWarnings(warnings),
      });
    }

    const staged = store.summary();
    const checks = domains.reduce((total, domain) => total + domain.checks.length, 0);
    const warnings = domains.reduce((total, domain) => total + domain.warnings.length, 0);
    return {
      canCommit: options.preview.canRestore
        && options.preview.requiredMigrations.length === 0
        && options.preview.summary.conflict === 0,
      summary: { tables: staged.tables, records: staged.records, checks, warnings },
      domains,
    };
  } catch (error) {
    if (error instanceof BackupIsolatedVerificationError) throw error;
    throw new BackupIsolatedVerificationError();
  }
}
