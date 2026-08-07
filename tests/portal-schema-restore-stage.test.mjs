import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  portalMigrationV2SecondaryStatements,
  portalMigrationV2Statements,
  portalMigrationV2TableStatements,
} from "../db/portal-migration-v2.ts";
import {
  normalizePortalRestoreStageSql,
  portalMigrationsV2,
} from "../db/portal-migrations-v2.ts";
import { portalMigrations } from "../db/portal-migrations.ts";
import {
  portalRestoreStageIndex,
  portalRestoreStageTable,
} from "../db/portal-restore-stage-schema.ts";

test("adds an immutable metadata-only migration after the unchanged baseline", async () => {
  assert.deepEqual(portalMigrations.map((migration) => migration.version), [1]);
  assert.deepEqual(portalMigrationsV2.map((migration) => migration.version), [1, 2]);
  assert.equal(portalMigrationsV2[0], portalMigrations[0]);
  assert.equal(portalMigrationsV2[1].name, "backup-restore-stage-metadata");
  assert.equal(portalMigrationsV2[1].statements, portalMigrationV2Statements);
  assert.equal(portalMigrationsV2[1].tableStatements, portalMigrationV2TableStatements);
  assert.equal(portalMigrationsV2[1].secondaryStatements, portalMigrationV2SecondaryStatements);
  assert.match(await portalMigrationsV2[0].checksum(), /^[0-9a-f]{64}$/);
  assert.match(await portalMigrationsV2[1].checksum(), /^[0-9a-f]{64}$/);
});

test("defines the exact restore stage metadata columns and one operational index", () => {
  assert.equal(portalRestoreStageTable.name, "portal_backup_restore_stages");
  assert.deepEqual(portalRestoreStageTable.columns, [
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
  ]);
  assert.equal(portalRestoreStageIndex.table, portalRestoreStageTable.name);
  assert.deepEqual(portalMigrationV2Statements, [
    portalRestoreStageTable.sql,
    portalRestoreStageIndex.sql,
  ]);
});

test("accepts the canonical SQLite index form without IF NOT EXISTS", () => {
  const sqliteMasterSql = portalRestoreStageIndex.sql.replace(" IF NOT EXISTS", "");
  assert.equal(
    normalizePortalRestoreStageSql(sqliteMasterSql),
    normalizePortalRestoreStageSql(portalRestoreStageIndex.sql),
  );
});

test("migration two remains immutable while production advances to the version four registry", () => {
  const migrationSource = fs.readFileSync(new URL("../db/portal-migration-v2.ts", import.meta.url), "utf8");
  const hardenedSource = fs.readFileSync(new URL("../db/portal-migrations-hardened.ts", import.meta.url), "utf8");
  const registrySource = fs.readFileSync(new URL("../db/portal-migrations-v2.ts", import.meta.url), "utf8");
  const schemaSource = fs.readFileSync(new URL("../db/portal-restore-stage-schema.ts", import.meta.url), "utf8");

  assert.doesNotMatch(migrationSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
  assert.doesNotMatch(migrationSource, /\b(?:DROP|ALTER)\b/i);
  assert.equal(hardenedSource.includes("portalMigrationsV4 as portalMigrations"), true);
  assert.equal(hardenedSource.includes("ensurePortalSchemaV4"), true);
  assert.equal(registrySource.includes("portalRestoreStageTable"), true);
  assert.equal(registrySource.includes("backup-restore-stage-metadata"), true);
  assert.equal(schemaSource.includes("portal_backup_restore_stages"), true);
});
