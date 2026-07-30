import assert from "node:assert/strict";
import test from "node:test";

import {
  portalBaselineStatements,
  portalSchemaIndexes,
  portalSchemaTables,
  portalSchemaTriggers,
} from "../db/portal-schema.ts";
import { portalMigrationV1Statements } from "../db/portal-migration-v1.ts";
import {
  clearPortalSchemaCacheForTests,
  ensurePortalSchema,
  ensurePortalSchemaWithRegistry,
  inspectPortalSchema,
  portalMigrations,
  publicPortalSchemaStatus,
} from "../db/portal-migrations.ts";

function result(changes = 0) {
  return { success: true, meta: { changes } };
}

function splitSqlList(value) {
  const output = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      current += character;
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      output.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

function cleanIdentifier(value) {
  return value.trim().replace(/^["`\[]|["`\]]$/g, "");
}

function tableBody(tableSql) {
  const start = tableSql.indexOf("(");
  const end = tableSql.lastIndexOf(")");
  return start >= 0 && end > start ? tableSql.slice(start + 1, end) : "";
}

function uniqueConstraints(tableSql) {
  const output = [];
  for (const clause of splitSqlList(tableBody(tableSql))) {
    const tableConstraint = clause.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\((.+)\)$/i);
    if (tableConstraint) {
      output.push(splitSqlList(tableConstraint[1]).map((column) => cleanIdentifier(column.split(/\s+/)[0])));
      continue;
    }
    if (!/\bUNIQUE\b/i.test(clause) || /\bPRIMARY\s+KEY\b/i.test(clause)) continue;
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    if (column) output.push([column]);
  }
  return output;
}

function parsedIndexColumns(sql) {
  const match = sql.match(/\bON\s+["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s*\((.+)\)\s*$/i);
  if (!match) return { table: "", columns: [] };
  return {
    table: match[1],
    columns: splitSqlList(match[2]).map((value) => {
      const parts = value.trim().split(/\s+/);
      const direction = parts.at(-1)?.toUpperCase();
      const desc = direction === "DESC";
      if (direction === "ASC" || direction === "DESC") parts.pop();
      return { name: cleanIdentifier(parts.join(" ")), desc };
    }),
  };
}

function parsedTableColumns(sql) {
  const clauses = splitSqlList(tableBody(sql));
  const tablePrimaryKeys = new Set();
  for (const clause of clauses) {
    const primary = clause.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\((.+)\)$/i);
    if (primary) splitSqlList(primary[1]).forEach((column) => tablePrimaryKeys.add(cleanIdentifier(column.split(/\s+/)[0])));
  }
  return clauses.flatMap((clause, index) => {
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+(TEXT|INTEGER)\b(.*)$/i);
    if (!column) return [];
    const name = column[1];
    const tail = column[3];
    const defaultMatch = tail.match(/\bDEFAULT\s+(.+?)(?:\s+(?:NOT|PRIMARY|UNIQUE|CHECK|REFERENCES)\b|$)/i);
    return [{
      cid: index,
      name,
      type: column[2].toUpperCase(),
      notnull: /\bNOT\s+NULL\b/i.test(tail) ? 1 : 0,
      dflt_value: defaultMatch?.[1] ?? null,
      pk: /\bPRIMARY\s+KEY\b/i.test(tail) || tablePrimaryKeys.has(name) ? index + 1 : 0,
    }];
  });
}

async function migrationChecksum(version, name, statements) {
  const material = JSON.stringify({ version, name, statements });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function migration(version, name, statements) {
  return { version, name, statements, checksum: () => migrationChecksum(version, name, statements) };
}

class MigrationMemoryD1 {
  tables = new Map();
  indexes = new Map();
  triggers = new Map();
  migrations = new Map();
  lock = null;
  rows = new Map();
  failPattern = null;
  batchCount = 0;
  lockRenewals = 0;
  stealLockOnRenewal = 0;

  constructor({ canonical = false } = {}) {
    if (canonical) this.installCanonicalObjects();
  }

  installTable(table) {
    this.tables.set(table.name, table.columns.map((column, index) => ({
      cid: index,
      name: column.name,
      type: column.type,
      notnull: column.notNull ? 1 : 0,
      dflt_value: null,
      pk: column.primaryKey ? index + 1 : 0,
    })));
    uniqueConstraints(table.sql).forEach((columns, index) => {
      const name = `sqlite_autoindex_${table.name}_${index + 1}`;
      this.indexes.set(name, { name, table: table.name, unique: 1, origin: "u", partial: 0, columns: columns.map((column) => ({ name: column, desc: false })), sql: null });
    });
  }

  installSqlTable(name, sql) {
    this.tables.set(name, parsedTableColumns(sql));
    uniqueConstraints(sql).forEach((columns, index) => {
      const indexName = `sqlite_autoindex_${name}_${index + 1}`;
      this.indexes.set(indexName, { name: indexName, table: name, unique: 1, origin: "u", partial: 0, columns: columns.map((column) => ({ name: column, desc: false })), sql: null });
    });
  }

  installCanonicalObjects() {
    for (const table of portalSchemaTables) this.installTable(table);
    for (const index of portalSchemaIndexes) {
      const parsed = parsedIndexColumns(index.sql);
      this.indexes.set(index.name, { name: index.name, table: index.table, unique: 0, origin: "c", partial: 0, columns: parsed.columns, sql: index.sql });
    }
    for (const trigger of portalSchemaTriggers) this.triggers.set(trigger.name, { name: trigger.name, table: trigger.table, sql: trigger.sql });
  }

  dropUnique(table, columns) {
    for (const [name, index] of this.indexes) {
      if (index.table === table && index.unique === 1 && index.columns.map((column) => column.name).join(",") === columns.join(",")) this.indexes.delete(name);
    }
  }

  snapshot() {
    return structuredClone({
      tables: [...this.tables],
      indexes: [...this.indexes],
      triggers: [...this.triggers],
      migrations: [...this.migrations],
      lock: this.lock,
      rows: [...this.rows],
    });
  }

  restore(snapshot) {
    this.tables = new Map(snapshot.tables);
    this.indexes = new Map(snapshot.indexes);
    this.triggers = new Map(snapshot.triggers);
    this.migrations = new Map(snapshot.migrations);
    this.lock = snapshot.lock;
    this.rows = new Map(snapshot.rows);
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
          const canonical = portalSchemaTables.find((item) => item.name === createTable[1]);
          if (!this.tables.has(createTable[1])) {
            if (canonical) this.installTable(canonical);
            else this.installSqlTable(createTable[1], normalized);
          }
          return result(0);
        }
        const createIndex = normalized.match(/^CREATE INDEX IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*) ON ([A-Za-z_][A-Za-z0-9_]*)/i);
        if (createIndex) {
          if (this.indexes.has(createIndex[1])) return result(0);
          const parsed = parsedIndexColumns(normalized);
          const available = new Set((this.tables.get(parsed.table) ?? []).map((column) => column.name));
          if (parsed.columns.some((column) => !available.has(column.name))) throw new Error("no such column for index");
          this.indexes.set(createIndex[1], { name: createIndex[1], table: createIndex[2], unique: 0, origin: "c", partial: 0, columns: parsed.columns, sql: normalized });
          return result(0);
        }
        const createTrigger = normalized.match(/^CREATE TRIGGER IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*) .* ON ([A-Za-z_][A-Za-z0-9_]*)/i);
        if (createTrigger) {
          if (!this.triggers.has(createTrigger[1])) this.triggers.set(createTrigger[1], { name: createTrigger[1], table: createTrigger[2], sql: normalized });
          return result(0);
        }
        const alterAddColumn = normalized.match(/^ALTER TABLE ([A-Za-z_][A-Za-z0-9_]*) ADD COLUMN ([A-Za-z_][A-Za-z0-9_]*) (TEXT|INTEGER)(.*)$/i);
        if (alterAddColumn) {
          const columns = this.tables.get(alterAddColumn[1]);
          if (!columns) throw new Error("no such table");
          if (columns.some((column) => column.name === alterAddColumn[2])) throw new Error("duplicate column name");
          const tail = alterAddColumn[4];
          columns.push({
            cid: columns.length,
            name: alterAddColumn[2],
            type: alterAddColumn[3].toUpperCase(),
            notnull: /\bNOT\s+NULL\b/i.test(tail) ? 1 : 0,
            dflt_value: tail.match(/\bDEFAULT\s+(.+)$/i)?.[1] ?? null,
            pk: 0,
          });
          return result(0);
        }

        if (normalized.startsWith("DELETE FROM portal_schema_lock WHERE id = ? AND acquired_at < ?")) {
          if (this.lock?.id === values[0] && this.lock.acquired_at < values[1]) this.lock = null;
          return result(0);
        }
        if (normalized.startsWith("INSERT OR IGNORE INTO portal_schema_lock")) {
          if (this.lock) return result(0);
          this.lock = { id: values[0], owner: values[1], acquired_at: values[2] };
          return result(1);
        }
        if (normalized.startsWith("UPDATE portal_schema_lock SET acquired_at = ? WHERE id = ? AND owner = ?")) {
          this.lockRenewals += 1;
          if (this.stealLockOnRenewal === this.lockRenewals && this.lock) this.lock.owner = "other";
          if (this.lock?.id === values[1] && this.lock.owner === values[2]) {
            this.lock.acquired_at = values[0];
            return result(1);
          }
          return result(0);
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
        if (normalized.startsWith("SELECT name, type, tbl_name, sql FROM sqlite_master")) {
          const objects = [];
          for (const name of this.tables.keys()) objects.push({ name, type: "table", tbl_name: name, sql: portalSchemaTables.find((table) => table.name === name)?.sql ?? null });
          for (const [name, index] of this.indexes) if (!name.startsWith("sqlite_")) objects.push({ name, type: "index", tbl_name: index.table, sql: index.sql });
          for (const [name, trigger] of this.triggers) objects.push({ name, type: "trigger", tbl_name: trigger.table, sql: trigger.sql });
          return { results: objects.sort((left, right) => left.name.localeCompare(right.name)) };
        }
        const tableInfo = normalized.match(/^PRAGMA table_info\("([A-Za-z_][A-Za-z0-9_]*)"\)$/i);
        if (tableInfo) return { results: (this.tables.get(tableInfo[1]) ?? []).map((column) => ({ ...column })) };
        const indexList = normalized.match(/^PRAGMA index_list\("([A-Za-z_][A-Za-z0-9_]*)"\)$/i);
        if (indexList) {
          return { results: [...this.indexes.values()].filter((index) => index.table === indexList[1]).map((index, seq) => ({ seq, name: index.name, unique: index.unique, origin: index.origin, partial: index.partial })) };
        }
        const indexXInfo = normalized.match(/^PRAGMA index_xinfo\("([^"\s]+)"\)$/i);
        if (indexXInfo) {
          const index = this.indexes.get(indexXInfo[1]);
          return { results: (index?.columns ?? []).map((column, seqno) => ({ seqno, cid: seqno, name: column.name, desc: column.desc ? 1 : 0, key: 1 })) };
        }
        throw new Error(`Unsupported all SQL: ${normalized}`);
      },
      first: async () => null,
    };
    return statement;
  }

  async batch(statements) {
    this.batchCount += 1;
    const before = this.snapshot();
    try {
      const output = [];
      for (const statement of statements) output.push(await statement.run());
      return output;
    } catch (error) {
      this.restore(before);
      throw error;
    }
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
  assert.equal(status.currentVersion, portalMigrations.at(-1).version);
  assert.equal(status.latestVersion, portalMigrations.at(-1).version);
  assert.deepEqual(status.appliedVersions, [1]);
  assert.deepEqual(status.pendingVersions, []);
  assert.equal(db.migrations.size, 1);
  assert.equal(db.tables.size, portalSchemaTables.length);
  assert.equal([...db.indexes.keys()].filter((name) => !name.startsWith("sqlite_")).length, portalSchemaIndexes.length);
  assert.equal(db.triggers.size, portalSchemaTriggers.length);
  assert.ok(db.lockRenewals >= 5);
});

test("keeps version one statements and checksum immutable when the registry grows", async () => {
  assert.equal(portalMigrations[0].statements, portalMigrationV1Statements);
  assert.notEqual(portalMigrations[0].statements, portalBaselineStatements);
  const before = await portalMigrations[0].checksum();
  const v2 = migration(2, "add-plugin-table", ["CREATE TABLE IF NOT EXISTS plugin_v2 (id TEXT PRIMARY KEY NOT NULL)"]);
  const db = new MigrationMemoryD1();
  const status = await ensurePortalSchemaWithRegistry(env(db), [portalMigrations[0], v2]);

  assert.equal(status.state, "ready");
  assert.equal(status.currentVersion, 2);
  assert.deepEqual(status.appliedVersions, [1, 2]);
  assert.equal(await portalMigrations[0].checksum(), before);
  assert.equal(portalMigrations[0].statements.some((statement) => statement.includes("plugin_v2")), false);
});

test("validates the final schema only after every pending migration", async () => {
  const first = migration(1, "journal-only-bootstrap", []);
  const second = migration(2, "install-canonical-schema", portalMigrationV1Statements);
  const db = new MigrationMemoryD1();
  const status = await ensurePortalSchemaWithRegistry(env(db), [first, second]);

  assert.equal(status.state, "ready");
  assert.equal(status.currentVersion, 2);
  assert.deepEqual(status.appliedVersions, [1, 2]);
  assert.equal(db.tables.size, portalSchemaTables.length);
});

test("coalesces concurrent readiness verification for the same database", async () => {
  const db = new MigrationMemoryD1();
  const [first, second] = await Promise.all([
    ensurePortalSchema(env(db), { cacheTtlMs: 0 }),
    ensurePortalSchema(env(db), { cacheTtlMs: 0 }),
  ]);

  assert.equal(first.state, "ready");
  assert.equal(second.state, "ready");
  assert.equal(db.batchCount, 2, "one shared baseline run should execute two transactional phases");
  assert.equal(db.migrations.size, 1);
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
  const checksumStatus = await ensurePortalSchema(env(checksumDb));
  assert.equal(checksumStatus.state, "failed");
  assert.equal(checksumStatus.errorCode, "schema_checksum_mismatch");

  clearPortalSchemaCacheForTests();
  const futureDb = new MigrationMemoryD1({ canonical: true });
  futureDb.migrations.set(99, { version: 99, name: "future", checksum: "future", applied_at: 1, execution_ms: 1 });
  const future = await ensurePortalSchema(env(futureDb));
  assert.equal(future.state, "failed");
  assert.equal(future.errorCode, "schema_future_version");
});

test("blocks missing canonical objects but reports safe additional objects as compatible drift", async () => {
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
  extraDb.indexes.set("plugin_data_idx", { name: "plugin_data_idx", table: "plugin_data", unique: 0, origin: "c", partial: 0, columns: [{ name: "id", desc: false }], sql: "CREATE INDEX plugin_data_idx ON plugin_data(id)" });
  extraDb.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });
  const extra = await inspectPortalSchema(env(extraDb));
  assert.equal(extra.state, "ready");
  assert.ok(extra.compatibleDrift.includes("table:plugin_data:extra"));
  assert.ok(extra.compatibleDrift.includes("column:portal_users.plugin_tag:extra"));
  assert.ok(extra.compatibleDrift.includes("index:plugin_data_idx:extra"));
});

test("rejects required extra columns without defaults", async () => {
  const db = new MigrationMemoryD1({ canonical: true });
  db.tables.get("portal_users").push({ cid: 99, name: "tenant_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 });
  db.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });

  const status = await inspectPortalSchema(env(db));
  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("column:portal_users.tenant_id:required_extra"));
});

test("verifies required UNIQUE, index and trigger definitions", async () => {
  const db = new MigrationMemoryD1({ canonical: true });
  db.dropUnique("portal_users", ["username"]);
  db.indexes.get("portal_sessions_user_idx").columns = [{ name: "expires_at", desc: false }];
  db.triggers.get("portal_audit_events_no_delete").sql = "CREATE TRIGGER portal_audit_events_no_delete BEFORE INSERT ON portal_audit_events BEGIN SELECT 1; END";
  db.migrations.set(1, { version: 1, name: portalMigrations[0].name, checksum: await portalMigrations[0].checksum(), applied_at: 1, execution_ms: 1 });

  const status = await inspectPortalSchema(env(db));
  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("unique:portal_users.username:missing"));
  assert.ok(status.incompatibleDrift.includes("index:portal_sessions_user_idx:definition"));
  assert.ok(status.incompatibleDrift.includes("trigger:portal_audit_events_no_delete:definition"));
});

test("classifies missing indexed columns before secondary DDL", async () => {
  const db = new MigrationMemoryD1({ canonical: true });
  db.tables.set("portal_sessions", db.tables.get("portal_sessions").filter((column) => column.name !== "user_id"));
  db.indexes.delete("portal_sessions_user_idx");
  const status = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });

  assert.equal(status.state, "incompatible");
  assert.equal(status.errorCode, "schema_incompatible_drift");
  assert.ok(status.incompatibleDrift.includes("column:portal_sessions.user_id:missing"));
  assert.equal(db.batchCount, 1, "secondary index/trigger batch must not run after table preflight drift");
  assert.equal(db.migrations.size, 0);
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

test("recovers when the idempotent baseline table phase committed before the atomic secondary phase", async () => {
  const db = new MigrationMemoryD1();
  db.failPattern = /INSERT INTO portal_schema_migrations/;
  const failed = await ensurePortalSchema(env(db), { maxLockAttempts: 1 });
  assert.equal(failed.state, "failed");
  assert.equal(db.tables.size, portalSchemaTables.length);
  assert.equal([...db.indexes.keys()].filter((name) => !name.startsWith("sqlite_")).length, 0);
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
