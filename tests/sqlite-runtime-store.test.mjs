import assert from "node:assert/strict";
import test from "node:test";

import {
  configureSqliteRuntimeDatabase,
  resolvePortalDatabasePath,
} from "../runtime/sqlite-runtime-store.mjs";

test("production database defaults to the explicit /data persistence boundary", () => {
  assert.equal(resolvePortalDatabasePath({}), "/data/portal.sqlite");
  assert.equal(resolvePortalDatabasePath({ PORTAL_DATA_DIR: "/srv/portal-data" }), "/srv/portal-data/portal.sqlite");
});

test("explicit database path must be absolute and contained by the configured data directory", () => {
  assert.equal(
    resolvePortalDatabasePath({ PORTAL_DATA_DIR: "/srv/portal-data", PORTAL_DATABASE_PATH: "/srv/portal-data/custom.sqlite" }),
    "/srv/portal-data/custom.sqlite",
  );
  assert.throws(
    () => resolvePortalDatabasePath({ PORTAL_DATA_DIR: "/srv/portal-data", PORTAL_DATABASE_PATH: "relative.sqlite" }),
    /absolute/u,
  );
  assert.throws(
    () => resolvePortalDatabasePath({ PORTAL_DATA_DIR: "/srv/portal-data", PORTAL_DATABASE_PATH: "/tmp/escape.sqlite" }),
    /inside PORTAL_DATA_DIR/u,
  );
});

test("configured data directory itself must be absolute", () => {
  assert.throws(() => resolvePortalDatabasePath({ PORTAL_DATA_DIR: "./data" }), /PORTAL_DATA_DIR must be absolute/u);
});

test("SQLite runtime enables explicit durability, concurrency and integrity pragmas", () => {
  const calls = [];
  const database = {
    pragma(value, options) {
      calls.push({ value, options });
      if (value === "journal_mode = WAL") return [{ journal_mode: "wal" }];
      return [];
    },
  };

  configureSqliteRuntimeDatabase(database);

  assert.deepEqual(calls.map((call) => call.value), [
    "journal_mode = WAL",
    "synchronous = NORMAL",
    "foreign_keys = ON",
    "busy_timeout = 5000",
  ]);
});

test("runtime fails closed when WAL cannot be enabled", () => {
  const database = {
    pragma(value) {
      if (value === "journal_mode = WAL") return [{ journal_mode: "delete" }];
      return [];
    },
  };
  assert.throws(() => configureSqliteRuntimeDatabase(database), /WAL journal mode/u);
});

test("runtime store rejects a driver without pragma support", () => {
  assert.throws(() => configureSqliteRuntimeDatabase({}), /pragma\(\)/u);
});
