import assert from "node:assert/strict";
import test from "node:test";

import { portalSchemaIndexes, portalSchemaTables, portalSchemaTriggers } from "../db/portal-schema.ts";
import {
  clearPortalSchemaCacheForTests,
  ensurePortalSchemaWithRegistry,
  inspectPortalSchema,
  portalMigrations,
} from "../db/portal-migrations.ts";

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

function tableBody(sql) {
  const start = sql.indexOf("(");
  const end = sql.lastIndexOf(")");
  return start >= 0 && end > start ? sql.slice(start + 1, end) : "";
}

function uniqueColumns(sql) {
  const output = [];
  for (const clause of splitSqlList(tableBody(sql))) {
    const tableConstraint = clause.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\((.+)\)/i);
    if (tableConstraint) {
      output.push(splitSqlList(tableConstraint[1]).map((column) => column.trim().replace(/^["`\[]|["`\]]$/g, "").split(/\s+/)[0]));
      continue;
    }
    if (!/\bUNIQUE\b/i.test(clause) || /\bPRIMARY\s+KEY\b/i.test(clause)) continue;
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    if (column) output.push([column]);
  }
  return output;
}

function indexColumns(sql) {
  const match = sql.match(/\bON\s+["`\[]?[A-Za-z_][A-Za-z0-9_]*["`\]]?\s*\((.+)\)\s*$/i);
  if (!match) return [];
  return splitSqlList(match[1]).map((value) => {
    const parts = value.trim().split(/\s+/);
    const direction = parts.at(-1)?.toUpperCase();
    const desc = direction === "DESC";
    if (direction === "ASC" || direction === "DESC") parts.pop();
    return { name: parts.join(" ").replace(/^["`\[]|["`\]]$/g, ""), desc };
  });
}

function result(changes = 0) {
  return { success: true, meta: { changes } };
}

class ReviewSafetyD1 {
  tables = new Map();
  tableSql = new Map();
  indexes = new Map();
  triggers = new Map();
  migrations = new Map();
  lock = null;

  constructor() {
    for (const table of portalSchemaTables) {
      this.tables.set(table.name, table.columns.map((column, index) => ({
        cid: index,
        name: column.name,
        type: column.type,
        notnull: column.notNull ? 1 : 0,
        dflt_value: null,
        pk: column.primaryKey ? index + 1 : 0,
      })));
      this.tableSql.set(table.name, table.sql);
      uniqueColumns(table.sql).forEach((columns, index) => {
        const name = `sqlite_autoindex_${table.name}_${index + 1}`;
        this.indexes.set(name, {
          name,
          table: table.name,
          unique: 1,
          partial: 0,
          columns: columns.map((column) => ({ name: column, desc: false })),
          sql: null,
        });
      });
    }
    for (const index of portalSchemaIndexes) {
      this.indexes.set(index.name, {
        name: index.name,
        table: index.table,
        unique: 0,
        partial: 0,
        columns: indexColumns(index.sql),
        sql: index.sql,
      });
    }
    for (const trigger of portalSchemaTriggers) {
      this.triggers.set(trigger.name, { name: trigger.name, table: trigger.table, sql: trigger.sql });
    }
  }

  prepare(sql) {
    let values = [];
    const normalized = sql.replace(/\s+/g, " ").trim();
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (/^CREATE TABLE IF NOT EXISTS /i.test(normalized)) return result(0);
        if (/^CREATE INDEX IF NOT EXISTS /i.test(normalized)) return result(0);
        if (/^CREATE TRIGGER IF NOT EXISTS /i.test(normalized)) return result(0);
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
          if (this.lock?.id === values[1] && this.lock.owner === values[2]) {
            this.lock.acquired_at = values[0];
            return result(1);
          }
          return result(0);
        }
        if (normalized.startsWith("DELETE FROM portal_schema_lock WHERE id = ? AND owner = ?")) {
          if (this.lock?.id === values[0] && this.lock.owner === values[1]) this.lock = null;
          return result(1);
        }
        if (normalized.startsWith("INSERT INTO portal_schema_migrations")) {
          this.migrations.set(Number(values[0]), {
            version: Number(values[0]),
            name: String(values[1]),
            checksum: String(values[2]),
            applied_at: Number(values[3]),
            execution_ms: Number(values[4]),
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
          for (const name of this.tables.keys()) objects.push({ name, type: "table", tbl_name: name, sql: this.tableSql.get(name) ?? null });
          for (const [name, index] of this.indexes) if (!name.startsWith("sqlite_")) objects.push({ name, type: "index", tbl_name: index.table, sql: index.sql });
          for (const [name, trigger] of this.triggers) objects.push({ name, type: "trigger", tbl_name: trigger.table, sql: trigger.sql });
          return { results: objects.sort((left, right) => left.name.localeCompare(right.name)) };
        }
        const tableInfo = normalized.match(/^PRAGMA table_info\("([A-Za-z_][A-Za-z0-9_]*)"\)$/i);
        if (tableInfo) return { results: this.tables.get(tableInfo[1]) ?? [] };
        const indexList = normalized.match(/^PRAGMA index_list\("([A-Za-z_][A-Za-z0-9_]*)"\)$/i);
        if (indexList) {
          return {
            results: [...this.indexes.values()]
              .filter((index) => index.table.toLowerCase() === indexList[1].toLowerCase())
              .map((index, seq) => ({ seq, name: index.name, unique: index.unique, origin: index.unique ? "u" : "c", partial: index.partial })),
          };
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
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

async function seedBaseline(db) {
  db.migrations.set(1, {
    version: 1,
    name: portalMigrations[0].name,
    checksum: await portalMigrations[0].checksum(),
    applied_at: 1,
    execution_ms: 1,
  });
}

async function migration(version, name, statements = []) {
  const checksum = async () => {
    const material = JSON.stringify({ version, name, statements });
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  return { version, name, statements, checksum };
}

test.beforeEach(() => clearPortalSchemaCacheForTests());

test("rejects a migration journal that is not an ordered registry prefix", async () => {
  const db = new ReviewSafetyD1();
  const v2 = await migration(2, "second-migration");
  db.migrations.set(2, { version: 2, name: v2.name, checksum: await v2.checksum(), applied_at: 2, execution_ms: 1 });

  const status = await ensurePortalSchemaWithRegistry({ DB: db }, [portalMigrations[0], v2], { maxLockAttempts: 1 });

  assert.equal(status.state, "failed");
  assert.equal(status.errorCode, "schema_journal_gap");
  assert.deepEqual(status.appliedVersions, [2]);
  assert.deepEqual(status.pendingVersions, [1]);
  assert.equal(db.migrations.has(1), false, "a corrupted journal must not be backfilled");
});

test("rejects extra triggers attached to canonical tables", async () => {
  const db = new ReviewSafetyD1();
  await seedBaseline(db);
  db.triggers.set("plugin_block_users", {
    name: "plugin_block_users",
    table: "portal_users",
    sql: "CREATE TRIGGER plugin_block_users BEFORE INSERT ON portal_users BEGIN SELECT RAISE(ABORT, 'blocked'); END",
  });

  const status = await inspectPortalSchema({ DB: db });

  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("trigger:plugin_block_users:unexpected_on_canonical_table"));
});

test("rejects extra triggers when SQLite preserves different table-name casing", async () => {
  const db = new ReviewSafetyD1();
  await seedBaseline(db);
  db.triggers.set("plugin_block_users_upper", {
    name: "plugin_block_users_upper",
    table: "PORTAL_USERS",
    sql: "CREATE TRIGGER plugin_block_users_upper BEFORE INSERT ON PORTAL_USERS BEGIN SELECT RAISE(ABORT, 'blocked'); END",
  });

  const status = await inspectPortalSchema({ DB: db });

  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("trigger:plugin_block_users_upper:unexpected_on_canonical_table"));
});

test("rejects added CHECK or foreign-key constraints on canonical tables", async () => {
  const checkDb = new ReviewSafetyD1();
  await seedBaseline(checkDb);
  const usersSql = checkDb.tableSql.get("portal_users");
  checkDb.tableSql.set("portal_users", usersSql.replace(/\)\s*$/, ", CHECK (role = 'admin'))"));

  const checkStatus = await inspectPortalSchema({ DB: checkDb });
  assert.equal(checkStatus.state, "incompatible");
  assert.ok(checkStatus.incompatibleDrift.includes("table:portal_users:restrictive_constraints"));

  clearPortalSchemaCacheForTests();
  const foreignKeyDb = new ReviewSafetyD1();
  await seedBaseline(foreignKeyDb);
  const sessionsSql = foreignKeyDb.tableSql.get("portal_sessions");
  foreignKeyDb.tableSql.set("portal_sessions", sessionsSql.replace(/\)\s*$/, ", FOREIGN KEY (user_id) REFERENCES portal_users(id))"));

  const foreignKeyStatus = await inspectPortalSchema({ DB: foreignKeyDb });
  assert.equal(foreignKeyStatus.state, "incompatible");
  assert.ok(foreignKeyStatus.incompatibleDrift.includes("table:portal_sessions:restrictive_constraints"));
});

test("rejects expanded composite primary keys on canonical tables", async () => {
  const db = new ReviewSafetyD1();
  await seedBaseline(db);
  db.tables.get("app_settings").push({ cid: 99, name: "tenant_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 2 });

  const status = await inspectPortalSchema({ DB: db });

  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("primary_key:app_settings:definition"));
});

test("rejects extra unique indexes on canonical tables", async () => {
  const db = new ReviewSafetyD1();
  await seedBaseline(db);
  db.indexes.set("plugin_unique_actor", {
    name: "plugin_unique_actor",
    table: "portal_audit_events",
    unique: 1,
    partial: 0,
    columns: [{ name: "actor_identity", desc: false }],
    sql: "CREATE UNIQUE INDEX plugin_unique_actor ON portal_audit_events(actor_identity)",
  });

  const status = await inspectPortalSchema({ DB: db });

  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("index:plugin_unique_actor:unexpected_unique_on_canonical_table"));
});

test("rejects NOT NULL extra columns whose SQL default evaluates to NULL", async () => {
  const db = new ReviewSafetyD1();
  await seedBaseline(db);
  db.tables.get("portal_users").push({ cid: 99, name: "tenant_id", type: "TEXT", notnull: 1, dflt_value: "(NULL)", pk: 0 });

  const status = await inspectPortalSchema({ DB: db });

  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("column:portal_users.tenant_id:required_extra"));
});

test("rejects changed conflict policies on required unique constraints", async () => {
  const db = new ReviewSafetyD1();
  await seedBaseline(db);
  const usersSql = db.tableSql.get("portal_users");
  db.tableSql.set("portal_users", usersSql.replace("username TEXT NOT NULL UNIQUE", "username TEXT NOT NULL UNIQUE ON CONFLICT REPLACE"));

  const status = await inspectPortalSchema({ DB: db });

  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("unique:portal_users.username:conflict_policy"));
});

test("does not journal baseline adoption before validating secondary definitions", async () => {
  const db = new ReviewSafetyD1();
  db.indexes.get("portal_sessions_user_idx").columns = [{ name: "expires_at", desc: false }];

  const status = await ensurePortalSchemaWithRegistry({ DB: db }, portalMigrations, { maxLockAttempts: 1 });

  assert.equal(status.state, "incompatible");
  assert.ok(status.incompatibleDrift.includes("index:portal_sessions_user_idx:definition"));
  assert.equal(db.migrations.has(1), false, "baseline journal must remain pending until secondary objects verify");
});
