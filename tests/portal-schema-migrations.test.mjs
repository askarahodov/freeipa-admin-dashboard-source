import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPortalSchemaCacheForTests,
  ensurePortalSchema,
  ensurePortalSchemaWithRegistry,
  inspectPortalSchema,
  portalMigrations,
  publicPortalSchemaStatus,
} from "../db/portal-migrations.ts";
import {
  portalSchemaIndexes,
  portalSchemaTables,
  portalSchemaTriggers,
} from "../db/portal-schema.ts";
import { MigrationMemoryD1 } from "./support/migration-memory-d1.mjs";

function env(db) {
  return { DB: db };
}

function migration(version, name, statements) {
  return {
    version,
    name,
    statements,
    checksum: async () => `${version}:${name}`,
  };
}

test("reports a missing production D1 binding as unavailable", async () => {
  clearPortalSchemaCacheForTests();
  const status = await ensurePortalSchema({});
  assert.equal(status.state, "unavailable");
  assert.equal(status.errorCode, "schema_database_unavailable");
});

test("bootstraps an empty D1 database and journals the immutable baseline", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1();
  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "ready");
  assert.deepEqual(status.appliedVersions, [1]);
  assert.deepEqual(status.pendingVersions, []);
  assert.equal(db.tables.size, portalSchemaTables.length);
  assert.equal(db.migrations.size, 1);
  assert.equal(db.indexes.size >= portalSchemaIndexes.length, true);
  assert.equal(db.triggers.size, portalSchemaTriggers.length);
});

test("adopts a runtime-created canonical schema without rewriting rows", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true });
  db.rows.set("portal_users", [{ id: "u-1", username: "admin" }]);

  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "ready");
  assert.equal(db.migrations.size, 1);
  assert.deepEqual(db.rows.get("portal_users"), [{ id: "u-1", username: "admin" }]);
  assert.equal(db.dataMutations, 0);
});

test("applies missing additive secondary objects while preserving compatible extras", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true });
  db.indexes.delete(portalSchemaIndexes[0].name);
  db.tables.set("custom_extension", [{ name: "id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }]);

  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "ready");
  assert.equal(db.indexes.has(portalSchemaIndexes[0].name), true);
  assert.equal(status.compatibleDrift.includes("table:custom_extension:extra"), true);
});

test("classifies a missing required column before attempting dependent index DDL", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true });
  db.tables.get("portal_sessions").splice(2, 1);

  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "incompatible");
  assert.equal(status.errorCode, "schema_incompatible_drift");
  assert.equal(status.incompatibleDrift.includes("column:portal_sessions.user_id:missing"), true);
  assert.equal(db.migrations.size, 0);
});

test("rejects a required unique constraint that is missing from an adopted database", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true });
  db.removeUniqueConstraint("portal_users", ["username"]);

  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "incompatible");
  assert.equal(status.incompatibleDrift.includes("unique:portal_users.username:missing"), true);
  assert.equal(db.migrations.size, 0);
});

test("rejects required indexes with wrong columns, direction, uniqueness or partial semantics", async () => {
  for (const mutate of [
    (db, index) => { index.columns = [{ name: "status", descending: false }]; },
    (db, index) => { index.columns = [{ name: "created_at", descending: false }]; },
    (db, index) => { index.unique = 1; },
    (db, index) => { index.partial = 1; },
  ]) {
    clearPortalSchemaCacheForTests();
    const db = new MigrationMemoryD1({ canonical: true });
    const index = db.indexes.get("operation_runs_created_at_idx");
    mutate(db, index);
    const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });
    assert.equal(status.state, "incompatible");
    assert.equal(status.incompatibleDrift.includes("index:operation_runs_created_at_idx:definition"), true);
    assert.equal(db.migrations.size, 0);
  }
});

test("rejects altered append-only audit trigger definitions", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true });
  const trigger = db.triggers.get("portal_audit_events_no_delete");
  trigger.sql = trigger.sql.replace("BEFORE DELETE", "AFTER DELETE");

  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "incompatible");
  assert.equal(status.incompatibleDrift.includes("trigger:portal_audit_events_no_delete:definition"), true);
  assert.equal(db.migrations.size, 0);
});

test("accepts nullable extra columns but rejects required extra columns without defaults", async () => {
  clearPortalSchemaCacheForTests();
  const compatibleDb = new MigrationMemoryD1({ canonical: true });
  compatibleDb.tables.get("portal_users").push({ name: "note", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
  const compatible = await ensurePortalSchema(env(compatibleDb), { maxLockAttempts: 1 });
  assert.equal(compatible.state, "ready");
  assert.equal(compatible.compatibleDrift.includes("column:portal_users.note:extra"), true);

  clearPortalSchemaCacheForTests();
  const incompatibleDb = new MigrationMemoryD1({ canonical: true });
  incompatibleDb.tables.get("portal_users").push({ name: "tenant_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 });
  const incompatible = await ensurePortalSchema(env(incompatibleDb), { maxLockAttempts: 1 });
  assert.equal(incompatible.state, "incompatible");
  assert.equal(incompatible.incompatibleDrift.includes("column:portal_users.tenant_id:required_extra"), true);
  assert.equal(incompatibleDb.migrations.size, 0);
});

test("reports checksum mismatch for a changed immutable migration", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true });
  db.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: "wrong", applied_at: 1, execution_ms: 1 });

  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });
  assert.equal(status.state, "failed");
  assert.equal(status.errorCode, "schema_checksum_mismatch");
});

test("derives the latest version from an ordered migration registry", async () => {
  const db = new MigrationMemoryD1({ canonical: true });
  db.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });
  const v2 = migration(2, "second", []);

  const status = await ensurePortalSchemaWithRegistry(env(db), [portalMigrations[0], v2], { maxLockAttempts: 1 });
  assert.equal(status.state, "ready");
  assert.equal(status.latestVersion, 2);
  assert.deepEqual(status.appliedVersions, [1, 2]);
});

test("keeps the version-one checksum stable when the final inventory grows", async () => {
  const before = await portalMigrations[0].checksum();
  portalSchemaTables.push?.({ name: "should_not_mutate", columns: [], sql: "" });
  const after = await portalMigrations[0].checksum();
  assert.equal(after, before);
});

test("applies multiple pending migrations before final canonical verification", async () => {
  const db = new MigrationMemoryD1({ canonical: true });
  db.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });
  const v2 = migration(2, "add-note", ["ALTER TABLE portal_users ADD COLUMN note TEXT"]);
  const v3 = migration(3, "add-profile", ["ALTER TABLE portal_users ADD COLUMN profile TEXT"]);

  const status = await ensurePortalSchemaWithRegistry(env(db), [portalMigrations[0], v2, v3], { maxLockAttempts: 1 });
  assert.equal(status.state, "ready");
  assert.deepEqual(status.appliedVersions, [1, 2, 3]);
});

test("coalesces concurrent production schema ensures", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true, queryDelayMs: 2 });
  const [first, second, third] = await Promise.all([
    ensurePortalSchema(env(db), { maxLockAttempts: 1 }),
    ensurePortalSchema(env(db), { maxLockAttempts: 1 }),
    ensurePortalSchema(env(db), { maxLockAttempts: 1 }),
  ]);
  assert.equal(first.state, "ready");
  assert.equal(second.state, "ready");
  assert.equal(third.state, "ready");
  assert.equal(db.lockAcquisitions, 1);
});

test("blocks additional NOT NULL columns without a default", async () => {
  clearPortalSchemaCacheForTests();
  const db = new MigrationMemoryD1({ canonical: true });
  db.tables.get("portal_users").push({ name: "required", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 });
  const status = await inspectPortalSchema(env(db));
  assert.equal(status.state, "incompatible");
  assert.equal(status.incompatibleDrift.includes("column:portal_users.required:required_extra"), true);
});

test("does not expose schema SQL or internal errors in the public status", async () => {
  const status = publicPortalSchemaStatus({
    state: "failed",
    currentVersion: 0,
    latestVersion: 1,
    appliedVersions: [],
    pendingVersions: [1],
    compatibleDrift: [],
    incompatibleDrift: [],
    errorCode: "schema_migration_failed",
    verifiedAt: 1,
  });
  assert.equal("sql" in status, false);
  assert.equal("checksum" in status, false);
  assert.equal("message" in status, false);
});

test("commits future migration DDL and journal atomically", async () => {
  const db = new MigrationMemoryD1({ canonical: true });
  db.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });
  const v2 = migration(2, "add-profile-note", ["ALTER TABLE portal_users ADD COLUMN profile_note TEXT"]);
  db.failPattern = /INSERT INTO portal_schema_migrations/;

  const failed = await ensurePortalSchemaWithRegistry(env(db), [portalMigrations[0], v2], { maxLockAttempts: 1 });
  assert.equal(failed.state, "failed");
  assert.equal(db.tables.get("portal_users").some((column) => column.name === "profile_note"), false);
  assert.equal(db.migrations.has(2), false);

  db.failPattern = null;
  const recovered = await ensurePortalSchemaWithRegistry(env(db), [portalMigrations[0], v2], { maxLockAttempts: 1 });
  assert.equal(recovered.state, "ready");
  assert.equal(db.tables.get("portal_users").some((column) => column.name === "profile_note"), true);
  assert.equal(db.migrations.has(2), true);
});

test("recovers when the idempotent baseline secondary phase committed before journaling", async () => {
  const db = new MigrationMemoryD1();
  db.failPattern = /INSERT INTO portal_schema_migrations/;
  const failed = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });
  assert.equal(failed.state, "failed");
  assert.equal(db.tables.size, portalSchemaTables.length);
  assert.equal([...db.indexes.keys()].filter((name) => !name.startsWith("sqlite_")).length, portalSchemaIndexes.length);
  assert.equal(db.triggers.size, portalSchemaTriggers.length);
  assert.equal(db.migrations.size, 0);

  db.failPattern = null;
  const recovered = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });
  assert.equal(recovered.state, "ready");
  assert.equal(db.migrations.size, 1);
});

test("renews and revalidates lock ownership before journaling", async () => {
  const db = new MigrationMemoryD1();
  db.stealLockOnRenewal = 3;
  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "busy");
  assert.equal(status.errorCode, "schema_migration_busy");
  assert.equal(db.migrations.size, 0);
  assert.equal(db.lock?.owner, "other");
});

test("returns busy for an active lock and replaces a stale lock", async () => {
  clearPortalSchemaCacheForTests();
  const active = new MigrationMemoryD1({ canonical: true });
  active.lock = { owner: "other", acquired_at: Date.now() };
  const busy = await ensurePortalSchema(env(active), { maxLockAttempts: 1 });
  assert.equal(busy.state, "busy");

  clearPortalSchemaCacheForTests();
  const stale = new MigrationMemoryD1({ canonical: true });
  stale.lock = { owner: "old", acquired_at: 1 };
  const ready = await ensurePortalSchema(env(stale), { maxLockAttempts: 1, now: () => 100_000, lockTtlMs: 1_000 });
  assert.equal(ready.state, "ready");
});

test("public migration status contains no SQL, checksums or raw internal failures", () => {
  const value = publicPortalSchemaStatus({
    state: "failed",
    currentVersion: 0,
    latestVersion: 1,
    appliedVersions: [],
    pendingVersions: [1],
    compatibleDrift: [],
    incompatibleDrift: [],
    errorCode: "schema_migration_failed",
    verifiedAt: 1,
  });
  assert.deepEqual(Object.keys(value).sort(), [
    "appliedVersions",
    "compatibleDrift",
    "currentVersion",
    "errorCode",
    "incompatibleDrift",
    "latestVersion",
    "pendingVersions",
    "state",
    "verifiedAt",
  ]);
});
