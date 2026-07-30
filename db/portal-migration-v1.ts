export const portalMigrationV1TableStatements = [
  "CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS operation_runs (
    id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, event_id TEXT NOT NULL, title TEXT NOT NULL,
    kind TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, actor TEXT NOT NULL, subject TEXT NOT NULL,
    error TEXT, stages_json TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
  )`,
  "CREATE TABLE IF NOT EXISTS xyops_catalog_snapshot (id TEXT PRIMARY KEY NOT NULL, catalog_json TEXT NOT NULL, synced_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS xyops_catalog_history (id TEXT PRIMARY KEY NOT NULL, synced_at INTEGER NOT NULL, changes_json TEXT NOT NULL, catalog_json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS xyops_catalog_sync_lock (id TEXT PRIMARY KEY NOT NULL, acquired_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS xyops_catalog_sync_runs (
    id TEXT PRIMARY KEY NOT NULL, trigger_name TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL,
    completed_at INTEGER, process_count INTEGER NOT NULL DEFAULT 0, change_count INTEGER NOT NULL DEFAULT 0, error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS operation_run_replays (
    run_id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL, schema_version TEXT NOT NULL, encrypted_spec TEXT,
    replayable INTEGER NOT NULL DEFAULT 0, reason TEXT, parent_run_id TEXT, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS operation_run_results (
    run_id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, summary TEXT, values_json TEXT NOT NULL DEFAULT '[]',
    links_json TEXT NOT NULL DEFAULT '[]', files_json TEXT NOT NULL DEFAULT '[]', table_json TEXT,
    truncated INTEGER NOT NULL DEFAULT 0, captured_at INTEGER NOT NULL
  )`,
  "CREATE TABLE IF NOT EXISTS operation_notifications (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS operation_notification_reads (notification_id TEXT NOT NULL, identity TEXT NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY (notification_id, identity))",
  "CREATE TABLE IF NOT EXISTS catalog_visibility_policies (id TEXT PRIMARY KEY NOT NULL, policy_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS approval_policy_sets (id TEXT PRIMARY KEY NOT NULL, policy_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS operation_approvals (
    id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
    schema_version TEXT NOT NULL, requester_identity TEXT NOT NULL, requester_role TEXT NOT NULL,
    requester_groups_json TEXT NOT NULL, status TEXT NOT NULL, required_approvals INTEGER NOT NULL,
    approver_roles_json TEXT NOT NULL, approver_groups_json TEXT NOT NULL, requester_cannot_approve INTEGER NOT NULL,
    rule_id TEXT NOT NULL, summary_json TEXT NOT NULL, encrypted_spec TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, approved_at INTEGER,
    executed_at INTEGER, run_id TEXT, parent_run_id TEXT, error TEXT
  )`,
  "CREATE TABLE IF NOT EXISTS operation_approval_decisions (approval_id TEXT NOT NULL, approver_identity TEXT NOT NULL, approver_role TEXT NOT NULL, decision TEXT NOT NULL, comment TEXT, decided_at INTEGER NOT NULL, PRIMARY KEY (approval_id, approver_identity))",
  "CREATE TABLE IF NOT EXISTS process_presentation_sets (id TEXT PRIMARY KEY NOT NULL, metadata_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS portal_users (
    id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS portal_sessions (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS portal_audit_events (
    id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, correlation_id TEXT NOT NULL, actor_identity TEXT NOT NULL,
    actor_role TEXT NOT NULL, actor_groups_json TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL,
    resource_id TEXT, event_id TEXT, schema_version TEXT, approval_id TEXT, run_id TEXT, job_id TEXT,
    outcome TEXT NOT NULL, error_code TEXT, metadata_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS portal_settings_drafts (
    id TEXT PRIMARY KEY NOT NULL, base_revision INTEGER NOT NULL, changes_json TEXT NOT NULL,
    encrypted_secrets TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, validation_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, validated_at INTEGER, applied_at INTEGER
  )`,
  "CREATE TABLE IF NOT EXISTS portal_settings_apply_commits (id TEXT PRIMARY KEY NOT NULL, draft_id TEXT NOT NULL, revision INTEGER NOT NULL, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL, created_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS portal_settings_revisions (
    id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL UNIQUE, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL,
    source_draft_id TEXT, created_by TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
    health_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
  )`,
  "CREATE TABLE IF NOT EXISTS portal_settings_draft_resets (draft_id TEXT PRIMARY KEY NOT NULL, reset_fields_json TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS portal_settings_source_lock (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, acquired_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS portal_schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL, execution_ms INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS portal_schema_lock (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, acquired_at INTEGER NOT NULL)",
] as const;

export const portalMigrationV1SecondaryStatements = [
  "CREATE INDEX IF NOT EXISTS operation_runs_started_at_idx ON operation_runs(started_at DESC)",
  "CREATE INDEX IF NOT EXISTS operation_runs_job_id_idx ON operation_runs(job_id)",
  "CREATE INDEX IF NOT EXISTS xyops_catalog_sync_runs_started_at_idx ON xyops_catalog_sync_runs(started_at DESC)",
  "CREATE INDEX IF NOT EXISTS operation_run_replays_event_idx ON operation_run_replays(event_id)",
  "CREATE INDEX IF NOT EXISTS operation_run_results_job_idx ON operation_run_results(job_id)",
  "CREATE INDEX IF NOT EXISTS operation_notifications_created_idx ON operation_notifications(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS operation_notification_reads_identity_idx ON operation_notification_reads(identity, read_at DESC)",
  "CREATE INDEX IF NOT EXISTS operation_approvals_status_idx ON operation_approvals(status, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS operation_approvals_requester_idx ON operation_approvals(requester_identity, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS operation_approval_decisions_approval_idx ON operation_approval_decisions(approval_id, decided_at)",
  "CREATE INDEX IF NOT EXISTS portal_sessions_user_idx ON portal_sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS portal_sessions_expires_idx ON portal_sessions(expires_at)",
  "CREATE INDEX IF NOT EXISTS portal_audit_events_created_idx ON portal_audit_events(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS portal_audit_events_correlation_idx ON portal_audit_events(correlation_id, created_at)",
  "CREATE INDEX IF NOT EXISTS portal_audit_events_approval_idx ON portal_audit_events(approval_id, created_at)",
  "CREATE INDEX IF NOT EXISTS portal_audit_events_run_idx ON portal_audit_events(run_id, created_at)",
  "CREATE INDEX IF NOT EXISTS portal_settings_drafts_updated_idx ON portal_settings_drafts(updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS portal_settings_apply_commits_created_idx ON portal_settings_apply_commits(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS portal_settings_revisions_created_idx ON portal_settings_revisions(created_at DESC)",
  "CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_update BEFORE UPDATE ON portal_audit_events BEGIN SELECT RAISE(ABORT, 'portal_audit_events is append-only'); END",
  "CREATE TRIGGER IF NOT EXISTS portal_audit_events_no_delete BEFORE DELETE ON portal_audit_events BEGIN SELECT RAISE(ABORT, 'portal_audit_events is append-only'); END",
] as const;

export const portalMigrationV1Statements = [
  ...portalMigrationV1TableStatements,
  ...portalMigrationV1SecondaryStatements,
] as const;
