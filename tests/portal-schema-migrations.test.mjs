import assert from "node:assert/strict";
import test from "node:test";

import { portalSchemaIndexes, portalSchemaTables, portalSchemaTriggers } from "../db/portal-schema.ts";
import {
  clearPortalSchemaCacheForTests,
  ensurePortalSchema,
  inspectPortalSchema,
  portalMigrations,
  publicPortalSchemaStatus,
} from "../db/portal-migrations.ts";

function result(changes = 0) {
  return { success: true, meta: { changes } };
}

class MigrationMemoryD1 {
  tables = new Map();
  indexes = new Map();
  triggers = new Map();
  migrations = new Map();
  lock = null;
  rows = new Map();
  failPattern = null;

  constructor({ canonical = false } = {}) {
    if (canonical) this.installCanonicalObjects();
  }

  installCanonicalObjects() {
    for (const table of portalSchemaTables) this.tables.set(table.name, table.columns.map((column, index) => ({
      cid: index,
      name: column.name,
      type: column.type,
      notnull: column.notNull ? 1 : 0,
      dflt_value: null,
      pk: column.primaryKey ? index + 1 : 0,
    })));
    for (const index of portalSchemaIndexes) this.indexes.set(index.name, index.table);
    for (const trigger of portalSchemaTriggers) this.triggers.set(trigger.name, trigger.table);
  }

  prepare(sql) {
    let values = [];
    const normalized = sql.replace(/\s+/g, " ").trim();
    const statement = {
      sql: normalized,
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (this.failPattern?.test(normalized)) throw new Error("sensitive internal SQL failure");

        const createTable = normalized.match(/^CREATE TABLE IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*)/i);
        if (createTable) {
          const table = portalSchemaTables.find((item) => item.name === createTable[1]);
          if (!table) throw new Error(`unknown canonical table ${createTable[1]}`);
          if (!this.tables.has(table.name)) this.tables.set(table.name, table.columns.map((column, index) => ({
            cid: index, name: column.name, type: column.type, notnull: column.notNull ? 1 : 0,
            dflt_value: null, pk: column.primaryKey ? index + 1 : 0,
          })));
          return result(0);
        }
        const createIndex = normalized.match(/^CREATE INDEX IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*) ON ([A-Za-z_][A-Za-z0-9_]*)/i);
        if (createIndex) { this.indexes.set(createIndex[1], createIndex[2]); return result(0); }
        const createTrigger = normalized.match(/^CREATE TRIGGER IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*) .* ON ([A-Za-z_][A-Za-z0-9_]*)/i);
        if (createTrigger) { this.triggers.set(createTrigger[1], createTrigger[2]); return result(0); }

        if (normalized.startsWith("DELETE FROM portal_schema_lock WHERE id = ? AND acquired_at < ?")) {
          if (this.lock?.id === values[0] && this.lock.acquired_at < values[1]) this.lock = null;
          return result(0);
        }
        if (normalized.startsWith("INSERT OR IGNORE INTO portal_schema_lock")) {
          if (this.lock) return result(0);
          this.lock = { id: values[0], owner: values[1], acquired_at: values[2] };
          return result(1);
        }
        if (normalized.startsWith("DELETE FROM portal_schema_lock WHERE id = ? AND owner = ?")) {
          if (this.lock?.id === values[0] && this.lock.owner === values[1]) { this.lock = null; return result(1); }
          return result(0);
        }
        if (normalized.startsWith("INSERT INTO portal_schema_migrations")) {
          this.migrations.set(Number(values[0]), {
            version: Number(values[0]), name: String(values[1]), checksum: String(values[2]),
            applied_at: Number(values[3]), execution_ms: Number(values[4]),
          });
          return result(1);
        }
        throw new Error(`Unsupported run SQL: ${normalized}`);
      },
      all: async () => {
        if (normalized.startsWith("SELECT version, name, checksum, applied_at, execution_ms FROM portal_schema_migrations")) {
          return { results: [...this.migrations.values()].sort((left, right) => left.version - right.version) };
        }
        if (normalized.startsWith("SELECT name, type, tbl_name FROM sqlite_master")) {
          const objects = [];
          for (const name of this.tables.keys()) objects.push({ name, type: "table", tbl_name: name });
          for (const [name, table] of this.indexes) objects.push({ name, type: "index", tbl_name: table });
          for (const [name, table] of this.triggers) objects.push({ name, type: "trigger", tbl_name: table });
          return { results: objects.sort((left, right) => left.name.localeCompare(right.name)) };
        }
        const pragma = normalized.match(/^PRAGMA table_info\("([A-Za-z_][A-Za-z0-9_]*)"\)$/i);
        if (pragma) return { results: (this.tables.get(pragma[1]) ?? []).map((column) => ({ ...column })) };
        throw new Error(`Unsupported all SQL: ${normalized}`);
      },
      first: async () => null,
    };
    return statement;
  }

  async batch(statements) {
    const output = [];
    for (const statement of statements) output.push(await statement.run());
    return output;
  }
}

function env(db) {
  return { DB: db };
}

function seedRow(db, table, row) {
  db.rows.set(table, [...(db.rows.get(table) ?? []), structuredClone(row)]);
}

test.beforeEach(() => clearPortalSchemaCacheForTests());

test("creates the canonical baseline and journals an empty database", async () => {
  const db = new MigrationMemoryD1();
  const status = await ensurePortalSchema(env(db), { now: () => 1_000 });

  assert.equal(status.state, "ready");
  assert.equal(status.currentVersion, 1);
  assert.deepEqual(status.appliedVersions, [1]);
  assert.deepEqual(status.pendingVersions, []);
  assert.equal(db.migrations.size, 1);
  assert.equal(db.tables.size, portalSchemaTables.length);
  assert.equal(db.indexes.size, portalSchemaIndexes.length);
  assert.equal(db.triggers.size, portalSchemaTriggers.length);
});

test("adopts a compatible runtime-created database without mutating existing rows", async () => {
  const db = new MigrationMemoryD1({ canonical: true });
  seedRow(db, "portal_users", { id: "existing-admin", username: "admin" });
  const before = structuredClone(db.rows.get("portal_users"));

  const status = await ensurePortalSchema(env(db), { now: () => 2_000 });

  assert.equal(status.state, "ready");
  assert.deepEqual(db.rows.get("portal_users"), before);
  assert.equal(db.migrations.get(1)?.name, "canonical-runtime-baseline");
});

test("repeated startup is idempotent and does not rewrite the journal", async () => {
  const db = new MigrationMemoryD1();
  const first = await ensurePortalSchema(env(db), { now: () => 3_000 });
  const appliedAt = db.migrations.get(1).applied_at;
  clearPortalSchemaCacheForTests();
  const second = await ensurePortalSchema(env(db), { now: () => 9_000 });

  assert.equal(first.state, "ready");
  assert.equal(second.state, "ready");
  assert.equal(db.migrations.size, 1);
  assert.equal(db.migrations.get(1).applied_at, appliedAt);
});

test("rejects a changed checksum and a database from a future application version", async () => {
  const checksumDb = new MigrationMemoryD1({ canonical: true });
  checksumDb.migrations.set(1, { version: 1, name: "canonical-runtime-baseline", checksum: "modified", applied_at: 1, execution_ms: 1 });
  const checksum = await ensurePortalSchema(env(checksumDb));
  assert.equal(checksum.state, "failed");
  assert.equal(checksum.errorCode, "schema_checksum_mismatch");

  clearPortalSchemaCacheForTests();
  const futureDb = new MigrationMemoryD1({ canonical: true });
  futureDb.migrations.set(99, { version: 99, name: "future", checksum: "future", applied_at: 1, execution_ms: 1 });
  const future = await ensurePortalSchema(env(futureDb));
  assert.equal(future.state, "failed");
  assert.equal(future.errorCode, "schema_future_version");
});

test("blocks missing canonical objects but reports additional objects as compatible drift", async () => {
  const missingDb = new MigrationMemoryD1({ canonical: true });
  missingDb.tables.get("portal_users").splice(1, 1);
  missingDb.indexes.delete("portal_sessions_user_idx");
  missingDb.triggers.delete("portal_audit_events_no_delete");
  missingDb.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });

  const missing = await inspectPortalSchema(env(missingDb));
  assert.equal(missing.state, "incompatible");
  assert.ok(missing.incompatibleDrift.includes("column:portal_users.username:missing"));
  assert.ok(missing.incompatibleDrift.includes("index:portal_sessions_user_idx:missing"));
  assert.ok(missing.incompatibleDrift.includes("trigger:portal_audit_events_no_delete:missing"));

  clearPortalSchemaCacheForTests();
  const extraDb = new MigrationMemoryD1({ canonical: true });
  extraDb.tables.set("plugin_data", [{ cid: 0, name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 }]);
  extraDb.tables.get("portal_users").push({ cid: 99, name: "plugin_tag", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
  extraDb.indexes.set("plugin_data_idx", "plugin_data");
  extraDb.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });
  const extra = await inspectPortalSchema(env(extraDb));
  assert.equal(extra.state, "ready");
  assert.ok(extra.compatibleDrift.includes("table:plugin_data:extra"));
  assert.ok(extra.compatibleDrift.includes("column:portal_users.plugin_tag:extra"));
  assert.ok(extra.compatibleDrift.includes("index:plugin_data_idx:extra"));
});

test("does not journal a baseline when DDL or structural verification fails", async () => {
  const ddlDb = new MigrationMemoryD1();
  ddlDb.failPattern = /CREATE TABLE IF NOT EXISTS operation_runs/;
  const ddl = await ensurePortalSchema(env(ddlDb), { maxLockAttempts: 1 });
  assert.equal(ddl.state, "failed");
  assert.equal(ddl.errorCode, "schema_migration_failed");
  assert.equal(ddlDb.migrations.size, 0);

  clearPortalSchemaCacheForTests();
  const driftDb = new MigrationMemoryD1({ canonical: true });
  driftDb.tables.get("portal_users").splice(1, 1);
  const drift = await ensurePortalSchema(env(driftDb), { maxLockAttempts: 1 });
  assert.equal(drift.state, "incompatible");
  assert.equal(driftDb.migrations.size, 0);
});

test("returns busy for an active lock and replaces a stale lock", async () => {
  const busyDb = new MigrationMemoryD1();
  busyDb.lock = { id: "main", owner: "other", acquired_at: 10_000 };
  const busy = await ensurePortalSchema(env(busyDb), { now: () => 10_100, maxLockAttempts: 1 });
  assert.equal(busy.state, "busy");
  assert.equal(busy.errorCode, "schema_migration_busy");

  clearPortalSchemaCacheForTests();
  const staleDb = new MigrationMemoryD1();
  staleDb.lock = { id: "main", owner: "abandoned", acquired_at: 1 };
  const recovered = await ensurePortalSchema(env(staleDb), { now: () => 100_000, maxLockAttempts: 1 });
  assert.equal(recovered.state, "ready");
  assert.equal(staleDb.lock, null);
});

test("public migration status contains no SQL, checksums or raw internal failures", async () => {
  const db = new MigrationMemoryD1();
  db.failPattern = /CREATE TABLE IF NOT EXISTS operation_runs/;
  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });
  const publicStatus = publicPortalSchemaStatus(status);
  const serialized = JSON.stringify(publicStatus);

  assert.equal(publicStatus.state, "failed");
  assert.equal(publicStatus.errorCode, "schema_migration_failed");
  assert.doesNotMatch(serialized, /CREATE TABLE|checksum|sensitive internal SQL failure|encrypted|password|token/i);
});
