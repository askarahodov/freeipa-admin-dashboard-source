export type PortalSchemaColumn = {
  name: string;
  type: "TEXT" | "INTEGER";
  notNull: boolean;
  primaryKey: boolean;
};

export type PortalSchemaTable = {
  name: string;
  columns: readonly PortalSchemaColumn[];
  sql: string;
};

export type PortalSchemaIndex = {
  name: string;
  table: string;
  sql: string;
};

export type PortalSchemaTrigger = {
  name: string;
  table: string;
  sql: string;
};

const c = (name: string, type: PortalSchemaColumn["type"], notNull = false, primaryKey = false): PortalSchemaColumn => ({
  name,
  type,
  notNull,
  primaryKey,
});

export const portalSchemaTables = [
  {
    name: "app_settings",
    columns: [c("id", "TEXT", true, true), c("config_json", "TEXT", true), c("encrypted_secrets", "TEXT", true), c("updated_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  },
  {
    name: "operation_runs",
    columns: [
      c("id", "TEXT", true, true), c("job_id", "TEXT", true), c("event_id", "TEXT", true), c("title", "TEXT", true),
      c("kind", "TEXT", true), c("mode", "TEXT", true), c("status", "TEXT", true), c("actor", "TEXT", true),
      c("subject", "TEXT", true), c("error", "TEXT"), c("stages_json", "TEXT", true), c("started_at", "INTEGER", true),
      c("updated_at", "INTEGER", true), c("completed_at", "INTEGER"),
    ],
    sql: `CREATE TABLE IF NOT EXISTS operation_runs (
      id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, event_id TEXT NOT NULL, title TEXT NOT NULL,
      kind TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, actor TEXT NOT NULL, subject TEXT NOT NULL,
      error TEXT, stages_json TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
    )`,
  },
  {
    name: "xyops_catalog_snapshot",
    columns: [c("id", "TEXT", true, true), c("catalog_json", "TEXT", true), c("synced_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS xyops_catalog_snapshot (id TEXT PRIMARY KEY NOT NULL, catalog_json TEXT NOT NULL, synced_at INTEGER NOT NULL)",
  },
  {
    name: "xyops_catalog_history",
    columns: [c("id", "TEXT", true, true), c("synced_at", "INTEGER", true), c("changes_json", "TEXT", true), c("catalog_json", "TEXT", true)],
    sql: "CREATE TABLE IF NOT EXISTS xyops_catalog_history (id TEXT PRIMARY KEY NOT NULL, synced_at INTEGER NOT NULL, changes_json TEXT NOT NULL, catalog_json TEXT NOT NULL)",
  },
  {
    name: "xyops_catalog_sync_lock",
    columns: [c("id", "TEXT", true, true), c("acquired_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS xyops_catalog_sync_lock (id TEXT PRIMARY KEY NOT NULL, acquired_at INTEGER NOT NULL)",
  },
  {
    name: "xyops_catalog_sync_runs",
    columns: [
      c("id", "TEXT", true, true), c("trigger_name", "TEXT", true), c("status", "TEXT", true), c("started_at", "INTEGER", true),
      c("completed_at", "INTEGER"), c("process_count", "INTEGER", true), c("change_count", "INTEGER", true), c("error", "TEXT"),
    ],
    sql: `CREATE TABLE IF NOT EXISTS xyops_catalog_sync_runs (
      id TEXT PRIMARY KEY NOT NULL, trigger_name TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL,
      completed_at INTEGER, process_count INTEGER NOT NULL DEFAULT 0, change_count INTEGER NOT NULL DEFAULT 0, error TEXT
    )`,
  },
  {
    name: "operation_run_replays",
    columns: [
      c("run_id", "TEXT", true, true), c("event_id", "TEXT", true), c("schema_version", "TEXT", true), c("encrypted_spec", "TEXT"),
      c("replayable", "INTEGER", true), c("reason", "TEXT"), c("parent_run_id", "TEXT"), c("created_at", "INTEGER", true),
    ],
    sql: `CREATE TABLE IF NOT EXISTS operation_run_replays (
      run_id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL, schema_version TEXT NOT NULL, encrypted_spec TEXT,
      replayable INTEGER NOT NULL DEFAULT 0, reason TEXT, parent_run_id TEXT, created_at INTEGER NOT NULL
    )`,
  },
  {
    name: "operation_run_results",
    columns: [
      c("run_id", "TEXT", true, true), c("job_id", "TEXT", true), c("summary", "TEXT"), c("values_json", "TEXT", true),
      c("links_json", "TEXT", true), c("files_json", "TEXT", true), c("table_json", "TEXT"), c("truncated", "INTEGER", true),
      c("captured_at", "INTEGER", true),
    ],
    sql: `CREATE TABLE IF NOT EXISTS operation_run_results (
      run_id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, summary TEXT, values_json TEXT NOT NULL DEFAULT '[]',
      links_json TEXT NOT NULL DEFAULT '[]', files_json TEXT NOT NULL DEFAULT '[]', table_json TEXT,
      truncated INTEGER NOT NULL DEFAULT 0, captured_at INTEGER NOT NULL
    )`,
  },
  {
    name: "operation_notifications",
    columns: [c("id", "TEXT", true, true), c("run_id", "TEXT", true), c("status", "TEXT", true), c("title", "TEXT", true), c("message", "TEXT", true), c("created_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS operation_notifications (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL)",
  },
  {
    name: "operation_notification_reads",
    columns: [c("notification_id", "TEXT", true, true), c("identity", "TEXT", true, true), c("read_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS operation_notification_reads (notification_id TEXT NOT NULL, identity TEXT NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY (notification_id, identity))",
  },
  {
    name: "catalog_visibility_policies",
    columns: [c("id", "TEXT", true, true), c("policy_json", "TEXT", true), c("updated_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS catalog_visibility_policies (id TEXT PRIMARY KEY NOT NULL, policy_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  },
  {
    name: "approval_policy_sets",
    columns: [c("id", "TEXT", true, true), c("policy_json", "TEXT", true), c("updated_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS approval_policy_sets (id TEXT PRIMARY KEY NOT NULL, policy_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  },
  {
    name: "operation_approvals",
    columns: [
      c("id", "TEXT", true, true), c("event_id", "TEXT", true), c("title", "TEXT", true), c("category", "TEXT", true),
      c("schema_version", "TEXT", true), c("requester_identity", "TEXT", true), c("requester_role", "TEXT", true), c("requester_groups_json", "TEXT", true),
      c("status", "TEXT", true), c("required_approvals", "INTEGER", true), c("approver_roles_json", "TEXT", true), c("approver_groups_json", "TEXT", true),
      c("requester_cannot_approve", "INTEGER", true), c("rule_id", "TEXT", true), c("summary_json", "TEXT", true), c("encrypted_spec", "TEXT", true),
      c("request_fingerprint", "TEXT", true), c("expires_at", "INTEGER", true), c("created_at", "INTEGER", true), c("updated_at", "INTEGER", true),
      c("approved_at", "INTEGER"), c("executed_at", "INTEGER"), c("run_id", "TEXT"), c("parent_run_id", "TEXT"), c("error", "TEXT"),
    ],
    sql: `CREATE TABLE IF NOT EXISTS operation_approvals (
      id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
      schema_version TEXT NOT NULL, requester_identity TEXT NOT NULL, requester_role TEXT NOT NULL,
      requester_groups_json TEXT NOT NULL, status TEXT NOT NULL, required_approvals INTEGER NOT NULL,
      approver_roles_json TEXT NOT NULL, approver_groups_json TEXT NOT NULL, requester_cannot_approve INTEGER NOT NULL,
      rule_id TEXT NOT NULL, summary_json TEXT NOT NULL, encrypted_spec TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, approved_at INTEGER,
      executed_at INTEGER, run_id TEXT, parent_run_id TEXT, error TEXT
    )`,
  },
  {
    name: "operation_approval_decisions",
    columns: [c("approval_id", "TEXT", true, true), c("approver_identity", "TEXT", true, true), c("approver_role", "TEXT", true), c("decision", "TEXT", true), c("comment", "TEXT"), c("decided_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS operation_approval_decisions (approval_id TEXT NOT NULL, approver_identity TEXT NOT NULL, approver_role TEXT NOT NULL, decision TEXT NOT NULL, comment TEXT, decided_at INTEGER NOT NULL, PRIMARY KEY (approval_id, approver_identity))",
  },
  {
    name: "process_presentation_sets",
    columns: [c("id", "TEXT", true, true), c("metadata_json", "TEXT", true), c("updated_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS process_presentation_sets (id TEXT PRIMARY KEY NOT NULL, metadata_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  },
  {
    name: "portal_users",
    columns: [
      c("id", "TEXT", true, true), c("username", "TEXT", true), c("display_name", "TEXT", true), c("password_hash", "TEXT", true),
      c("password_salt", "TEXT", true), c("password_iterations", "INTEGER", true), c("role", "TEXT", true), c("disabled", "INTEGER", true),
      c("failed_attempts", "INTEGER", true), c("locked_until", "INTEGER"), c("created_at", "INTEGER", true), c("updated_at", "INTEGER", true), c("last_login_at", "INTEGER"),
    ],
    sql: `CREATE TABLE IF NOT EXISTS portal_users (
      id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER
    )`,
  },
  {
    name: "portal_sessions",
    columns: [
      c("id", "TEXT", true, true), c("user_id", "TEXT", true), c("token_hash", "TEXT", true), c("created_at", "INTEGER", true),
      c("last_seen_at", "INTEGER", true), c("expires_at", "INTEGER", true), c("user_agent", "TEXT", true),
    ],
    sql: `CREATE TABLE IF NOT EXISTS portal_sessions (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT NOT NULL DEFAULT ''
    )`,
  },
  {
    name: "portal_audit_events",
    columns: [
      c("id", "TEXT", true, true), c("created_at", "INTEGER", true), c("correlation_id", "TEXT", true), c("actor_identity", "TEXT", true),
      c("actor_role", "TEXT", true), c("actor_groups_json", "TEXT", true), c("action", "TEXT", true), c("resource_type", "TEXT", true),
      c("resource_id", "TEXT"), c("event_id", "TEXT"), c("schema_version", "TEXT"), c("approval_id", "TEXT"), c("run_id", "TEXT"),
      c("job_id", "TEXT"), c("outcome", "TEXT", true), c("error_code", "TEXT"), c("metadata_json", "TEXT", true),
    ],
    sql: `CREATE TABLE IF NOT EXISTS portal_audit_events (
      id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, correlation_id TEXT NOT NULL, actor_identity TEXT NOT NULL,
      actor_role TEXT NOT NULL, actor_groups_json TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL,
      resource_id TEXT, event_id TEXT, schema_version TEXT, approval_id TEXT, run_id TEXT, job_id TEXT,
      outcome TEXT NOT NULL, error_code TEXT, metadata_json TEXT NOT NULL
    )`,
  },
  {
    name: "portal_settings_drafts",
    columns: [
      c("id", "TEXT", true, true), c("base_revision", "INTEGER", true), c("changes_json", "TEXT", true), c("encrypted_secrets", "TEXT", true),
      c("status", "TEXT", true), c("validation_json", "TEXT", true), c("created_by", "TEXT", true), c("created_at", "INTEGER", true),
      c("updated_at", "INTEGER", true), c("validated_at", "INTEGER"), c("applied_at", "INTEGER"),
    ],
    sql: `CREATE TABLE IF NOT EXISTS portal_settings_drafts (
      id TEXT PRIMARY KEY NOT NULL, base_revision INTEGER NOT NULL, changes_json TEXT NOT NULL,
      encrypted_secrets TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, validation_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, validated_at INTEGER, applied_at INTEGER
    )`,
  },
  {
    name: "portal_settings_apply_commits",
    columns: [c("id", "TEXT", true, true), c("draft_id", "TEXT", true), c("revision", "INTEGER", true), c("config_json", "TEXT", true), c("encrypted_secrets", "TEXT", true), c("created_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS portal_settings_apply_commits (id TEXT PRIMARY KEY NOT NULL, draft_id TEXT NOT NULL, revision INTEGER NOT NULL, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL, created_at INTEGER NOT NULL)",
  },
  {
    name: "portal_settings_revisions",
    columns: [
      c("id", "TEXT", true, true), c("revision", "INTEGER", true), c("config_json", "TEXT", true), c("encrypted_secrets", "TEXT", true),
      c("source_draft_id", "TEXT"), c("created_by", "TEXT", true), c("reason", "TEXT", true), c("status", "TEXT", true),
      c("health_json", "TEXT", true), c("created_at", "INTEGER", true),
    ],
    sql: `CREATE TABLE IF NOT EXISTS portal_settings_revisions (
      id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL UNIQUE, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL,
      source_draft_id TEXT, created_by TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
      health_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
    )`,
  },
  {
    name: "portal_settings_draft_resets",
    columns: [c("draft_id", "TEXT", true, true), c("reset_fields_json", "TEXT", true), c("created_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS portal_settings_draft_resets (draft_id TEXT PRIMARY KEY NOT NULL, reset_fields_json TEXT NOT NULL, created_at INTEGER NOT NULL)",
  },
  {
    name: "portal_settings_source_lock",
    columns: [c("id", "TEXT", true, true), c("owner", "TEXT", true), c("acquired_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS portal_settings_source_lock (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, acquired_at INTEGER NOT NULL)",
  },
  {
    name: "portal_schema_migrations",
    columns: [c("version", "INTEGER", true, true), c("name", "TEXT", true), c("checksum", "TEXT", true), c("applied_at", "INTEGER", true), c("execution_ms", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS portal_schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL, execution_ms INTEGER NOT NULL)",
  },
  {
    name: "portal_schema_lock",
    columns: [c("id", "TEXT", true, true), c("owner", "TEXT", true), c("acquired_at", "INTEGER", true)],
    sql: "CREATE TABLE IF NOT EXISTS portal_schema_lock (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, acquired_at INTEGER NOT NULL)",
  },
] as const satisfies readonly PortalSchemaTable[];

export const portalSchemaIndexes = [
  { name: "operation_runs_started_at_idx", table: "operation_runs", sql: "CREATE INDEX IF NOT EXISTS operation_runs_started_at_idx ON operation_runs(started_at DESC)" },
  { name: "operation_runs_job_id_idx", table: "operation_runs", sql: "CREATE INDEX IF NOT EXISTS operation_runs_job_id_idx ON operation_runs(job_id)" },
  { name: "xyops_catalog_sync_runs_started_at_idx", table: "xyops_catalog_sync_runs", sql: "CREATE INDEX IF NOT EXISTS xyops_catalog_sync_runs_started_at_idx ON xyops_catalog_sync_runs(started_at DESC)" },
  { name: "operation_run_replays_event_idx", table: "operation_run_replays", sql: "CREATE INDEX IF NOT EXISTS operation_run_replays_event_idx ON operation_run_replays(event_id)" },
  { name: "operation_run_results_job_idx", table: "operation_run_results", sql: "CREATE INDEX IF NOT EXISTS operation_run_results_job_idx ON operation_run_results(job_id)" },
  { name: "operation_notifications_created_idx", table: "operation_notifications", sql: "CREATE INDEX IF NOT EXISTS operation_notifications_created_idx ON operation_notifications(created_at DESC)" },
  { name: "operation_notification_reads_identity_idx", table: "operation_notification_reads", sql: "CREATE INDEX IF NOT EXISTS operation_notification_reads_identity_idx ON operation_notification_reads(identity, read_at DESC)" },
  { name: "operation_approvals_status_idx", table: "operation_approvals", sql: "CREATE INDEX IF NOT EXISTS operation_approvals_status_idx ON operation_approvals(status, created_at DESC)" },
  { name: "operation_approvals_requester_idx", table: "operation_approvals", sql: "CREATE INDEX IF NOT EXISTS operation_approvals_requester_idx ON operation_approvals(requester_identity, created_at DESC)" },
  { name: "operation_approval_decisions_approval_idx", table: "operation_approval_decisions", sql: "CREATE INDEX IF NOT EXISTS operation_approval_decisions_approval_idx ON operation_approval_decisions(approval_id, decided_at)" },
  { name: "portal_sessions_user_idx", table: "portal_sessions", sql: "CREATE INDEX IF NOT EXISTS portal_sessions_user_idx ON portal_sessions(user_id)" },
  { name: "portal_sessions_expires_idx", table: "portal_sessions", sql: "CREATE INDEX IF NOT EXISTS portal_sessions_expires_idx ON portal_sessions(expires_at)" },
  { name: "portal_audit_events_created_idx", table: "portal_audit_events", sql: "CREATE INDEX IF NOT EXISTS portal_audit_events_created_idx ON portal_audit_events(created_at DESC)" },
  { name: "portal_audit_events_correlation_idx", table: "portal_audit_events", sql: "CREATE INDEX IF NOT EXISTS portal_audit_events_correlation_idx ON portal_audit_events(correlation_id, created_at)" },
  { name: "portal_audit_events_approval_idx", table: "portal_audit_events", sql: "CREATE INDEX IF NOT EXISTS portal_audit_events_approval_idx ON portal_audit_events(approval_id, created_at)" },
  { name: "portal_audit_events_run_idx", table: "portal_audit_events", sql: "CREATE INDEX IF NOT EXISTS portal_audit_events_run_idx ON portal_audit_events(run_id, created_at)" },
  { name: "portal_settings_drafts_updated_idx", table: "portal_settings_drafts", sql: "CREATE INDEX IF NOT EXISTS portal_settings_drafts_updated_idx ON portal_settings_drafts(updated_at DESC)" },
  { name: "portal_settings_apply_commits_created_idx", table: "portal_settings_apply_commits", sql: "CREATE INDEX IF NOT EXISTS portal_settings_apply_commits_created_idx ON portal_settings_apply_commits(created_at DESC)" },
  { name: "portal_settings_revisions_created_idx", table: "portal_settings_revisions", sql: "CREATE INDEX IF NOT EXISTS portal_settings_revisions_created_idx ON portal_settings_revisions(created_at DESC)" },
] as const satisfies readonly PortalSchemaIndex[];

export const portalSchemaTriggers = [
  {
    name: "portal_audit_events_no_update",
    table: "portal_audit_events",
    sql: "CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_update BEFORE UPDATE ON portal_audit_events BEGIN SELECT RAISE(ABORT, 'portal_audit_events is append-only'); END",
  },
  {
    name: "portal_audit_events_no_delete",
    table: "portal_audit_events",
    sql: "CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_delete BEFORE DELETE ON portal_audit_events BEGIN SELECT RAISE(ABORT, 'portal_audit_events is append-only'); END",
  },
] as const satisfies readonly PortalSchemaTrigger[];

export const portalSchemaTableNames = new Set<string>(portalSchemaTables.map((table) => table.name));

export const portalBaselineStatements = [
  ...portalSchemaTables.map((table) => table.sql),
  ...portalSchemaIndexes.map((index) => index.sql),
  ...portalSchemaTriggers.map((trigger) => trigger.sql),
] as readonly string[];
