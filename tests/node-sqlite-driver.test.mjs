import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openNodeSqliteDriver } from "../runtime/node-sqlite-driver.mjs";

async function withDatabasePath(run) {
  const directory = await mkdtemp(join(tmpdir(), "portal-node-sqlite-"));
  const path = join(directory, "portal.sqlite");
  try {
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("node:sqlite driver persists data across close and reopen", async () => {
  await withDatabasePath(async (path) => {
    const first = openNodeSqliteDriver(path);
    first.prepare("CREATE TABLE records (id TEXT PRIMARY KEY, value INTEGER NOT NULL)").run();
    first.prepare("INSERT INTO records (id, value) VALUES (?, ?)").run("alpha", 7);
    first.close();

    const second = openNodeSqliteDriver(path);
    assert.deepEqual(second.prepare("SELECT id, value FROM records WHERE id = ?").get("alpha"), { id: "alpha", value: 7 });
    second.close();
  });
});

test("node:sqlite transaction rolls back all writes after an error", async () => {
  await withDatabasePath(async (path) => {
    const database = openNodeSqliteDriver(path);
    database.prepare("CREATE TABLE records (id TEXT PRIMARY KEY, value INTEGER NOT NULL)").run();
    const transaction = database.transaction(() => {
      database.prepare("INSERT INTO records (id, value) VALUES (?, ?)").run("alpha", 7);
      throw new Error("abort transaction");
    });

    assert.throws(() => transaction(), /abort transaction/u);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM records").get().count, 0);
    database.close();
  });
});

test("node:sqlite driver exposes the runtime pragma contract and WAL checkpoint close", async () => {
  await withDatabasePath(async (path) => {
    const database = openNodeSqliteDriver(path);
    const journal = database.pragma("journal_mode = WAL");
    assert.equal(String(journal[0]?.journal_mode).toLowerCase(), "wal");
    database.pragma("synchronous = NORMAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.prepare("CREATE TABLE records (id INTEGER PRIMARY KEY)").run();
    database.prepare("INSERT INTO records DEFAULT VALUES").run();
    assert.doesNotThrow(() => database.close());
  });
});

test("node:sqlite driver rejects work after close and unsafe pragma strings", async () => {
  await withDatabasePath(async (path) => {
    const database = openNodeSqliteDriver(path);
    assert.throws(() => database.pragma("journal_mode=WAL; DROP TABLE records"), /single PRAGMA/u);
    database.close();
    assert.throws(() => database.prepare("SELECT 1"), /closed/u);
  });
});
