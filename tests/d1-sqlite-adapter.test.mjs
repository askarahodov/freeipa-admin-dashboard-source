import assert from "node:assert/strict";
import test from "node:test";

import { createD1SqliteAdapter } from "../runtime/d1-sqlite-adapter.mjs";

function fakeDatabase() {
  const rows = new Map([
    ["alpha", { id: "alpha", value: 7 }],
    ["beta", { id: "beta", value: 9 }],
  ]);
  const calls = [];
  let transactionCount = 0;

  return {
    calls,
    get transactionCount() { return transactionCount; },
    prepare(sql) {
      const reader = /^\s*SELECT\b/iu.test(sql);
      return {
        reader,
        get(...params) {
          calls.push({ kind: "get", sql, params });
          if (/WHERE id = \?/u.test(sql)) return rows.get(String(params[0]));
          return [...rows.values()][0];
        },
        all(...params) {
          calls.push({ kind: "all", sql, params });
          return [...rows.values()];
        },
        run(...params) {
          calls.push({ kind: "run", sql, params });
          if (/INSERT/u.test(sql)) rows.set(String(params[0]), { id: String(params[0]), value: Number(params[1]) });
          return { changes: 1, lastInsertRowid: 42 };
        },
      };
    },
    transaction(fn) {
      return (...args) => {
        transactionCount += 1;
        return fn(...args);
      };
    },
  };
}

test("adapter exposes only the proven D1 surface", () => {
  const db = createD1SqliteAdapter(fakeDatabase());
  assert.deepEqual(Object.keys(db).sort(), ["batch", "prepare"]);
  assert.deepEqual(
    Object.keys(db.prepare("SELECT id FROM records")).sort(),
    ["all", "bind", "first", "run"],
  );
  assert.equal("exec" in db, false);
  assert.equal("raw" in db.prepare("SELECT id FROM records"), false);
});

test("prepare and bind are immutable and first supports row or column access", async () => {
  const driver = fakeDatabase();
  const db = createD1SqliteAdapter(driver);
  const prepared = db.prepare("SELECT id, value FROM records WHERE id = ?");
  const alpha = prepared.bind("alpha");
  const beta = prepared.bind("beta");

  assert.deepEqual(await alpha.first(), { id: "alpha", value: 7 });
  assert.equal(await beta.first("value"), 9);
  assert.deepEqual(driver.calls.map((call) => call.params), [["alpha"], ["beta"]]);
});

test("all returns D1-shaped results without leaking driver objects", async () => {
  const db = createD1SqliteAdapter(fakeDatabase());
  const result = await db.prepare("SELECT id, value FROM records ORDER BY id").all();

  assert.equal(result.success, true);
  assert.deepEqual(result.results, [{ id: "alpha", value: 7 }, { id: "beta", value: 9 }]);
  assert.equal(typeof result.meta, "object");
});

test("run maps SQLite changes and last insert id into D1 metadata", async () => {
  const db = createD1SqliteAdapter(fakeDatabase());
  const result = await db.prepare("INSERT INTO records (id, value) VALUES (?, ?)").bind("gamma", 11).run();

  assert.equal(result.success, true);
  assert.equal(result.meta.changes, 1);
  assert.equal(result.meta.last_row_id, 42);
});

test("batch executes statements once inside one driver transaction and preserves result order", async () => {
  const driver = fakeDatabase();
  const db = createD1SqliteAdapter(driver);
  const result = await db.batch([
    db.prepare("INSERT INTO records (id, value) VALUES (?, ?)").bind("gamma", 11),
    db.prepare("SELECT id, value FROM records ORDER BY id"),
  ]);

  assert.equal(driver.transactionCount, 1);
  assert.equal(result.length, 2);
  assert.equal(result[0].meta.changes, 1);
  assert.deepEqual(result[1].results.at(-1), { id: "gamma", value: 11 });
});

test("adapter rejects foreign prepared statements in batch", async () => {
  const db = createD1SqliteAdapter(fakeDatabase());
  await assert.rejects(() => db.batch([{ run() {} }]), /prepared by this adapter/u);
});
