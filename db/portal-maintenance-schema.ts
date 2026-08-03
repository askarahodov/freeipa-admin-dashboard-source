import type { PortalSchemaIndex, PortalSchemaTable } from "./portal-schema.ts";

export const portalMaintenanceStateTable = {
  name: "portal_maintenance_state",
  columns: [
    { name: "id", type: "TEXT", notNull: true, primaryKey: true },
    { name: "state", type: "TEXT", notNull: true, primaryKey: false },
    { name: "operation_id", type: "TEXT", notNull: false, primaryKey: false },
    { name: "actor_identity", type: "TEXT", notNull: false, primaryKey: false },
    { name: "actor_groups_json", type: "TEXT", notNull: true, primaryKey: false },
    { name: "controller_secret_hash", type: "TEXT", notNull: false, primaryKey: false },
    { name: "created_at", type: "INTEGER", notNull: false, primaryKey: false },
    { name: "updated_at", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "expires_at", type: "INTEGER", notNull: false, primaryKey: false },
    { name: "completed_at", type: "INTEGER", notNull: false, primaryKey: false },
    { name: "failure_code", type: "TEXT", notNull: false, primaryKey: false },
    { name: "verification_json", type: "TEXT", notNull: true, primaryKey: false },
  ],
  sql: `CREATE TABLE IF NOT EXISTS portal_maintenance_state (
    id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL, operation_id TEXT, actor_identity TEXT,
    actor_groups_json TEXT NOT NULL, controller_secret_hash TEXT, created_at INTEGER,
    updated_at INTEGER NOT NULL, expires_at INTEGER, completed_at INTEGER,
    failure_code TEXT, verification_json TEXT NOT NULL
  )`,
} as const satisfies PortalSchemaTable;

export const portalMaintenanceStateIndex = {
  name: "portal_maintenance_state_state_idx",
  table: "portal_maintenance_state",
  sql: "CREATE INDEX IF NOT EXISTS portal_maintenance_state_state_idx ON portal_maintenance_state(state, updated_at)",
} as const satisfies PortalSchemaIndex;
