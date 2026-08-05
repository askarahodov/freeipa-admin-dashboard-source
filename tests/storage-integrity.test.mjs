import assert from "node:assert/strict";
import test from "node:test";

import { portalSchemaIndexes } from "../db/portal-schema.ts";
import { inspectStorageIntegrity } from "../storage-integrity.ts";

const QUICK_CHECK_SQL = "PRAGMA quick_check(1)";
const INDEX_INVENTORY_SQL = "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'";

function canonicalIndexRows() {
  return portalSchemaIndexes.map((index) => ({
    name: index.name,
    tbl_name: index.table,
    sql: index.sql,
  }));
}

function queryFixture(options = {}) {
  const calls = [];
  const query = {
    async first(sql) {
      calls.push(sql);
      assert.equal(sql, QUICK_CHECK_SQL);
      if (options.quickCheckGate) await options.quickCheckGate;
      if (options.quickCheckError) throw new Error(options.quickCheckError);
      return { quick_check: options.quickCheckValue ?? "ok" };
    },
    async all(sql) {
      calls.push(sql);
      assert.equal(sql, INDEX_INVENTORY_SQL);
      if (options.inventoryGate) await options.inventoryGate;
      if (options.inventoryError) throw new Error(options.inventoryError);
      return options.indexRows ?? canonicalIndexRows();
    },
  };
  return { query, calls };
}

test("healthy integrity check runs exactly one fixed quick check and one canonical index inventory", async () => {
  const { query, calls } = queryFixture();
  const report = await inspectStorageIntegrity(
    { DB: {} },
    { query, now: () => 1_754_400_000_000 },
  );

  assert.equal(report.contractVersion, "1");
  assert.equal(report.generatedAt, 1_754_400_000_000);
  assert.equal(report.durationMs, 0);
  assert.equal(report.state, "healthy");
  assert.deepEqual(report.quickCheck, {
    state: "healthy",
    code: "storage_quick_check_ok",
  });
  assert.deepEqual(report.indexes, {
    expected: portalSchemaIndexes.length,
    present: portalSchemaIndexes.length,
    missing: 0,
    mismatched: 0,
    unexpected: 0,
    code: "storage_indexes_ready",
  });
  assert.deepEqual(calls, [QUICK_CHECK_SQL, INDEX_INVENTORY_SQL]);

  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "sqlite_schema",
    "quick_check",
    portalSchemaIndexes[0].name,
    portalSchemaIndexes[0].table,
    portalSchemaIndexes[0].sql,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("failed quick check degrades with a fixed code and discards raw result text", async () => {
  const secret = "database-corruption-detail portal_users /var/lib/private.sqlite";
  const { query } = queryFixture({ quickCheckValue: secret });
  const report = await inspectStorageIntegrity({ DB: {} }, { query });

  assert.equal(report.state, "degraded");
  assert.deepEqual(report.quickCheck, {
    state: "failed",
    code: "storage_quick_check_failed",
  });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("database-corruption-detail"), false);
  assert.equal(serialized.includes("portal_users"), false);
  assert.equal(serialized.includes("private.sqlite"), false);
});

test("unsupported quick check remains a completed degraded diagnostic", async () => {
  const secret = "no such pragma: quick_check bearer-secret-sentinel";
  const { query } = queryFixture({ quickCheckError: secret });
  const report = await inspectStorageIntegrity({ DB: {} }, { query });

  assert.equal(report.state, "degraded");
  assert.deepEqual(report.quickCheck, {
    state: "unsupported",
    code: "storage_quick_check_unsupported",
  });
  assert.equal(JSON.stringify(report).includes("bearer-secret-sentinel"), false);
});

test("ordinary quick check failure is unavailable and never exposes raw exception text", async () => {
  const secret = "file:///var/lib/private.sqlite authorization-bearer-sentinel";
  const { query } = queryFixture({ quickCheckError: secret });
  const report = await inspectStorageIntegrity({ DB: {} }, { query });

  assert.equal(report.state, "unavailable");
  assert.deepEqual(report.quickCheck, {
    state: "unavailable",
    code: "storage_quick_check_unavailable",
  });
  assert.equal(JSON.stringify(report).includes("private.sqlite"), false);
  assert.equal(JSON.stringify(report).includes("authorization-bearer-sentinel"), false);
});

test("missing mismatched and unexpected portal indexes are exposed only as counts", async () => {
  const rows = canonicalIndexRows();
  const missing = rows.at(-1);
  const mismatched = rows[0];
  const actualRows = rows
    .filter((row) => row !== missing)
    .map((row) => row === mismatched
      ? { ...row, sql: `CREATE INDEX ${row.name} ON private_shadow_table(secret_column)` }
      : row);
  actualRows.push({
    name: "portal_shadow_idx",
    tbl_name: "private_shadow_table",
    sql: "CREATE INDEX portal_shadow_idx ON private_shadow_table(secret_column)",
  });

  const { query } = queryFixture({ indexRows: actualRows });
  const report = await inspectStorageIntegrity({ DB: {} }, { query });

  assert.equal(report.state, "degraded");
  assert.deepEqual(report.indexes, {
    expected: portalSchemaIndexes.length,
    present: portalSchemaIndexes.length - 1,
    missing: 1,
    mismatched: 1,
    unexpected: 1,
    code: "storage_indexes_degraded",
  });
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    missing.name,
    mismatched.name,
    "portal_shadow_idx",
    "private_shadow_table",
    "secret_column",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("equivalent canonical index definitions tolerate case whitespace and IF NOT EXISTS", async () => {
  const rows = canonicalIndexRows().map((row) => ({
    ...row,
    tbl_name: row.tbl_name.toUpperCase(),
    sql: row.sql
      .replace("CREATE INDEX IF NOT EXISTS", "  create   index ")
      .replaceAll(" ", "   ")
      .toUpperCase(),
  }));
  const { query } = queryFixture({ indexRows: rows });
  const report = await inspectStorageIntegrity({ DB: {} }, { query });

  assert.equal(report.state, "healthy");
  assert.equal(report.indexes.mismatched, 0);
});

test("inventory failure makes the result unavailable without leaking database details", async () => {
  const secret = "sqlite:///srv/private.db token-secret-sentinel";
  const { query } = queryFixture({ inventoryError: secret });
  const report = await inspectStorageIntegrity({ DB: {} }, { query });

  assert.equal(report.state, "unavailable");
  assert.deepEqual(report.indexes, {
    expected: portalSchemaIndexes.length,
    present: 0,
    missing: 0,
    mismatched: 0,
    unexpected: 0,
    code: "storage_indexes_unavailable",
  });
  assert.equal(JSON.stringify(report).includes("private.db"), false);
  assert.equal(JSON.stringify(report).includes("token-secret-sentinel"), false);
});

test("missing database returns unavailable without invoking the query adapter", async () => {
  let calls = 0;
  const report = await inspectStorageIntegrity({}, {
    query: {
      async first() { calls += 1; return { quick_check: "ok" }; },
      async all() { calls += 1; return canonicalIndexRows(); },
    },
  });

  assert.equal(report.state, "unavailable");
  assert.equal(report.quickCheck.code, "storage_quick_check_unavailable");
  assert.equal(report.indexes.code, "storage_indexes_unavailable");
  assert.equal(calls, 0);
});

test("public counts and duration are bounded safe integers", async () => {
  const excessiveRows = Array.from({ length: 10_050 }, (_, index) => ({
    name: `portal_unexpected_${index}_idx`,
    tbl_name: "private_table",
    sql: `CREATE INDEX portal_unexpected_${index}_idx ON private_table(value)`,
  }));
  const { query } = queryFixture({ indexRows: [...canonicalIndexRows(), ...excessiveRows] });
  let current = 1_754_400_000_000;
  const report = await inspectStorageIntegrity(
    { DB: {} },
    {
      query,
      now: () => {
        const value = current;
        current += 999_999;
        return value;
      },
    },
  );

  assert.equal(report.durationMs, 60_000);
  assert.equal(report.indexes.unexpected, 10_000);
});

test("overlapping integrity checks are coalesced and completed reports are not cached", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { query, calls } = queryFixture({ quickCheckGate: gate });
  const dependencies = { query, now: () => 1_754_400_000_000 };

  const first = inspectStorageIntegrity({ DB: {} }, dependencies);
  const second = inspectStorageIntegrity({ DB: {} }, dependencies);
  await Promise.resolve();
  assert.equal(calls.filter((sql) => sql === QUICK_CHECK_SQL).length, 1);

  release();
  const [firstReport, secondReport] = await Promise.all([first, second]);
  assert.deepEqual(secondReport, firstReport);
  assert.equal(calls.filter((sql) => sql === QUICK_CHECK_SQL).length, 1);
  assert.equal(calls.filter((sql) => sql === INDEX_INVENTORY_SQL).length, 1);

  await inspectStorageIntegrity({ DB: {} }, dependencies);
  assert.equal(calls.filter((sql) => sql === QUICK_CHECK_SQL).length, 2);
  assert.equal(calls.filter((sql) => sql === INDEX_INVENTORY_SQL).length, 2);
});
