import type { PortalSchemaTable } from "./portal-schema.ts";

export const portalMigrationOperationsTable = {
  name: "portal_migration_operations",
  columns: [
    { name: "id", type: "TEXT", notNull: true, primaryKey: true },
    { name: "operation_id", type: "TEXT", notNull: true, primaryKey: false },
    { name: "maintenance_operation_id", type: "TEXT", notNull: true, primaryKey: false },
    { name: "from_version", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "target_version", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "total_count", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "applied_count", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "state", type: "TEXT", notNull: true, primaryKey: false },
    { name: "created_at", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "started_at", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "updated_at", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "completed_at", type: "INTEGER", notNull: false, primaryKey: false },
    { name: "failure_code", type: "TEXT", notNull: false, primaryKey: false },
  ],
  sql: `CREATE TABLE IF NOT EXISTS portal_migration_operations (
    id TEXT PRIMARY KEY NOT NULL CHECK (id = 'main'),
    operation_id TEXT NOT NULL,
    maintenance_operation_id TEXT NOT NULL,
    from_version INTEGER NOT NULL CHECK (from_version >= 0),
    target_version INTEGER NOT NULL CHECK (target_version >= from_version),
    total_count INTEGER NOT NULL CHECK (total_count BETWEEN 0 AND 1000),
    applied_count INTEGER NOT NULL CHECK (applied_count BETWEEN 0 AND total_count),
    state TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed', 'interrupted', 'reconciled')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    started_at INTEGER NOT NULL CHECK (started_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
    failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 80)
  )`,
} as const satisfies PortalSchemaTable;

export const portalMigrationV4TableStatements = Object.freeze([
  portalMigrationOperationsTable.sql,
]);

export const portalMigrationV4SecondaryStatements = Object.freeze([] as string[]);

export const portalMigrationV4Statements = Object.freeze([
  ...portalMigrationV4TableStatements,
  ...portalMigrationV4SecondaryStatements,
]);
