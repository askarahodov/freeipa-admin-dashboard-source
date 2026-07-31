import type { PortalSchemaIndex, PortalSchemaTable } from "./portal-schema.ts";

export const portalRestoreStageTable = {
  name: "portal_backup_restore_stages",
  columns: [
    { name: "id", type: "TEXT", notNull: true, primaryKey: true },
    { name: "operation", type: "TEXT", notNull: true, primaryKey: false },
    { name: "actor_identity", type: "TEXT", notNull: true, primaryKey: false },
    { name: "selected_domains_json", type: "TEXT", notNull: true, primaryKey: false },
    { name: "stage_secret_hash", type: "TEXT", notNull: true, primaryKey: false },
    { name: "source_binding_hash", type: "TEXT", notNull: true, primaryKey: false },
    { name: "recovery_binding_hash", type: "TEXT", notNull: true, primaryKey: false },
    { name: "source_schema_version", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "current_schema_version", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "status", type: "TEXT", notNull: true, primaryKey: false },
    { name: "created_at", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "expires_at", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "completed_at", type: "INTEGER", notNull: false, primaryKey: false },
  ],
  sql: `CREATE TABLE IF NOT EXISTS portal_backup_restore_stages (
    id TEXT PRIMARY KEY NOT NULL, operation TEXT NOT NULL, actor_identity TEXT NOT NULL,
    selected_domains_json TEXT NOT NULL, stage_secret_hash TEXT NOT NULL,
    source_binding_hash TEXT NOT NULL, recovery_binding_hash TEXT NOT NULL,
    source_schema_version INTEGER NOT NULL, current_schema_version INTEGER NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, completed_at INTEGER
  )`,
} as const satisfies PortalSchemaTable;

export const portalRestoreStageIndex = {
  name: "portal_backup_restore_stages_status_idx",
  table: "portal_backup_restore_stages",
  sql: "CREATE INDEX IF NOT EXISTS portal_backup_restore_stages_status_idx ON portal_backup_restore_stages(status, expires_at)",
} as const satisfies PortalSchemaIndex;
