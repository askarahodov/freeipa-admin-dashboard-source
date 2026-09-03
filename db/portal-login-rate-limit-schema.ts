import type { PortalSchemaTable } from "./portal-schema.ts";

export const portalLoginRateLimitsTable = {
  name: "portal_login_rate_limits",
  columns: [
    { name: "scope", type: "TEXT", notNull: true, primaryKey: true },
    { name: "subject_hash", type: "TEXT", notNull: true, primaryKey: true },
    { name: "failures", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "window_started_at", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "blocked_until", type: "INTEGER", notNull: true, primaryKey: false },
    { name: "updated_at", type: "INTEGER", notNull: true, primaryKey: false },
  ],
  sql: `CREATE TABLE IF NOT EXISTS portal_login_rate_limits (
    scope TEXT NOT NULL,
    subject_hash TEXT NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    window_started_at INTEGER NOT NULL,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope, subject_hash)
  )`,
} as const satisfies PortalSchemaTable;
