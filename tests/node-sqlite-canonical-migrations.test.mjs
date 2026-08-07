import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensurePortalSchema, inspectPortalSchema } from "../db/portal-migrations.ts";
import { createD1SqliteAdapter } from "../runtime/d1-sqlite-adapter.mjs";
import { openNodeSqliteDriver } from "../runtime/node-sqlite-driver.mjs";

test("Node SQLite boots and reopens the canonical portal schema", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portal-node-schema-"));
  const path = join(directory, "portal.sqlite");
  try {
    const firstDriver = openNodeSqliteDriver(path);
    firstDriver.pragma("journal_mode = WAL");
    firstDriver.pragma("synchronous = NORMAL");
    firstDriver.pragma("foreign_keys = ON");
    firstDriver.pragma("busy_timeout = 5000");
    const firstDb = createD1SqliteAdapter(firstDriver);

    const boot = await ensurePortalSchema({ DB: firstDb }, { retryDelayMs: 0, cacheTtlMs: 0 });
    assert.equal(boot.state, "ready");
    assert.equal(boot.currentVersion, boot.latestVersion);
    firstDriver.close();

    const secondDriver = openNodeSqliteDriver(path);
    secondDriver.pragma("journal_mode = WAL");
    secondDriver.pragma("synchronous = NORMAL");
    secondDriver.pragma("foreign_keys = ON");
    secondDriver.pragma("busy_timeout = 5000");
    const secondDb = createD1SqliteAdapter(secondDriver);

    const reopened = await inspectPortalSchema({ DB: secondDb }, { cacheTtlMs: 0 });
    assert.equal(reopened.state, "ready");
    assert.equal(reopened.currentVersion, reopened.latestVersion);
    secondDriver.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
