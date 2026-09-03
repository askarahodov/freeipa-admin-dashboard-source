import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  portalMaintenanceStateIndex,
  portalMaintenanceStateTable,
} from "../db/portal-maintenance-schema.ts";
import {
  portalMigrationV3SecondaryStatements,
  portalMigrationV3Statements,
  portalMigrationV3TableStatements,
} from "../db/portal-migration-v3.ts";
import {
  normalizePortalMaintenanceSql,
  portalMigrationsV3,
} from "../db/portal-migrations-v3.ts";
import { portalMigrationsV2 } from "../db/portal-migrations-v2.ts";

test("adds immutable maintenance migration after unchanged version two registry", async () => {
  assert.deepEqual(portalMigrationsV2.map((migration) => migration.version), [1, 2]);
  assert.deepEqual(portalMigrationsV3.map((migration) => migration.version), [1, 2, 3]);
  assert.equal(portalMigrationsV3[0], portalMigrationsV2[0]);
  assert.equal(portalMigrationsV3[1], portalMigrationsV2[1]);
  assert.equal(portalMigrationsV3[2].name, "maintenance-mode-foundation");
  assert.equal(portalMigrationsV3[2].statements, portalMigrationV3Statements);
  assert.equal(portalMigrationsV3[2].tableStatements, portalMigrationV3TableStatements);
  assert.equal(portalMigrationsV3[2].secondaryStatements, portalMigrationV3SecondaryStatements);
  assert.match(await portalMigrationsV3[2].checksum(), /^[0-9a-f]{64}$/);
});

test("defines exact singleton maintenance columns and operational index", () => {
  assert.equal(portalMaintenanceStateTable.name, "portal_maintenance_state");
  assert.deepEqual(portalMaintenanceStateTable.columns, [
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
  ]);
  assert.equal(portalMaintenanceStateIndex.table, portalMaintenanceStateTable.name);
  assert.deepEqual(portalMigrationV3Statements, [
    portalMaintenanceStateTable.sql,
    portalMaintenanceStateIndex.sql,
  ]);
});

test("accepts canonical SQLite DDL without IF NOT EXISTS", () => {
  assert.equal(
    normalizePortalMaintenanceSql(portalMaintenanceStateIndex.sql.replace(" IF NOT EXISTS", "")),
    normalizePortalMaintenanceSql(portalMaintenanceStateIndex.sql),
  );
});

test("migration three remains immutable while hardened production uses registry v5", () => {
  const migrationSource = fs.readFileSync(new URL("../db/portal-migration-v3.ts", import.meta.url), "utf8");
  const hardenedSource = fs.readFileSync(new URL("../db/portal-migrations-hardened.ts", import.meta.url), "utf8");
  const registrySource = fs.readFileSync(new URL("../db/portal-migrations-v3.ts", import.meta.url), "utf8");

  assert.doesNotMatch(migrationSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
  assert.doesNotMatch(migrationSource, /\b(?:DROP|ALTER)\b/i);
  assert.equal(hardenedSource.includes("portalMigrationsV5 as portalMigrations"), true);
  assert.equal(hardenedSource.includes("ensurePortalSchemaV5"), true);
  assert.equal(registrySource.includes("portalMaintenanceStateTable"), true);
  assert.equal(registrySource.includes("maintenance-mode-foundation"), true);
});
