import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeDatabase } from "../runtime/runtime-database.mjs";

function dependencies({ schemaState = "ready", failAt = "" } = {}) {
  const events = [];
  const driver = {
    pragma() { events.push("pragma"); return [{ journal_mode: "wal" }]; },
    prepare() {},
    transaction() {},
    close() { events.push("close"); },
  };
  const db = { prepare() {}, batch() {} };
  return {
    events,
    driver,
    db,
    openDriver(path) {
      events.push(`open:${path}`);
      if (failAt === "open") throw new Error("open failed");
      return driver;
    },
    configureDatabase(value) {
      events.push("configure");
      assert.equal(value, driver);
      if (failAt === "configure") throw new Error("configure failed");
      return value;
    },
    createAdapter(value) {
      events.push("adapter");
      assert.equal(value, driver);
      if (failAt === "adapter") throw new Error("adapter failed");
      return db;
    },
    async ensureSchema(env) {
      events.push("schema");
      assert.equal(env.DB, db);
      if (failAt === "schema") throw new Error("schema failed");
      return { state: schemaState, errorCode: schemaState === "ready" ? "" : "schema_not_ready" };
    },
  };
}

test("runtime database opens the owned persistence path and exposes a ready D1 binding", async () => {
  const deps = dependencies();
  const runtime = await createRuntimeDatabase({
    env: { PORTAL_DATA_DIR: "/srv/portal-data" },
    ...deps,
  });

  assert.equal(runtime.path, "/srv/portal-data/portal.sqlite");
  assert.equal(runtime.DB, deps.db);
  assert.equal(runtime.schema.state, "ready");
  assert.deepEqual(deps.events, [
    "open:/srv/portal-data/portal.sqlite",
    "configure",
    "adapter",
    "schema",
  ]);

  runtime.close();
  runtime.close();
  assert.equal(deps.events.filter((event) => event === "close").length, 1);
});

test("runtime database fails closed and closes the driver when canonical schema is not ready", async () => {
  const deps = dependencies({ schemaState: "incompatible" });
  await assert.rejects(
    () => createRuntimeDatabase({ env: {}, ...deps }),
    /schema is not ready: incompatible/u,
  );
  assert.equal(deps.events.at(-1), "close");
});

test("runtime database closes an opened driver after setup failures", async () => {
  for (const failAt of ["configure", "adapter", "schema"]) {
    const deps = dependencies({ failAt });
    await assert.rejects(() => createRuntimeDatabase({ env: {}, ...deps }));
    assert.equal(deps.events.filter((event) => event === "close").length, 1, failAt);
  }
});

test("runtime database does not close a driver that was never opened", async () => {
  const deps = dependencies({ failAt: "open" });
  await assert.rejects(() => createRuntimeDatabase({ env: {}, ...deps }), /open failed/u);
  assert.equal(deps.events.includes("close"), false);
});

test("runtime database requires explicit injectable infrastructure functions", async () => {
  await assert.rejects(
    () => createRuntimeDatabase({ env: {}, openDriver() { return {}; } }),
    /configureDatabase must be a function/u,
  );
});
