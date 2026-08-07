import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createD1SqliteAdapter } from "../runtime/d1-sqlite-adapter.mjs";
import { openNodeSqliteDriver } from "../runtime/node-sqlite-driver.mjs";

test("built-in Node SQLite satisfies the narrow D1 adapter contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portal-node-d1-"));
  const path = join(directory, "portal.sqlite");
  try {
    const driver = openNodeSqliteDriver(path);
    driver.pragma("journal_mode = WAL");
    const db = createD1SqliteAdapter(driver);

    await db.prepare("CREATE TABLE records (id TEXT PRIMARY KEY, value INTEGER NOT NULL)").run();
    await db.prepare("INSERT INTO records (id, value) VALUES (?, ?)").bind("alpha", 7).run();
    assert.deepEqual(await db.prepare("SELECT id, value FROM records WHERE id = ?").bind("alpha").first(), { id: "alpha", value: 7 });

    const batch = await db.batch([
      db.prepare("INSERT INTO records (id, value) VALUES (?, ?)").bind("beta", 9),
      db.prepare("SELECT id, value FROM records ORDER BY id"),
    ]);
    assert.equal(batch[0].meta.changes, 1);
    assert.deepEqual(batch[1].results, [{ id: "alpha", value: 7 }, { id: "beta", value: 9 }]);
    assert.equal(Object.getPrototypeOf(batch[1].results[0]), Object.prototype);
    driver.close();

    const reopenedDriver = openNodeSqliteDriver(path);
    const reopened = createD1SqliteAdapter(reopenedDriver);
    assert.equal(await reopened.prepare("SELECT value FROM records WHERE id = ?").bind("beta").first("value"), 9);
    reopenedDriver.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
