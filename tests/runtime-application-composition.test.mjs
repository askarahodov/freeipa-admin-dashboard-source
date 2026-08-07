import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeApplication } from "../runtime/runtime-application.mjs";

function fakeRuntimeDatabase(events = []) {
  let closed = 0;
  return {
    path: "/data/portal.sqlite",
    DB: { kind: "d1-binding" },
    schema: { state: "ready", currentVersion: 3, latestVersion: 3 },
    close() {
      closed += 1;
      events.push("database:close");
    },
    get closed() { return closed; },
  };
}

test("runtime application starts database before HTTP and injects the ready DB binding", async () => {
  const events = [];
  const database = fakeRuntimeDatabase(events);
  const application = await createRuntimeApplication({
    env: { PORTAL_RUNTIME_PROFILE: "production", FEATURE_FLAG: "enabled" },
    async createDatabase() {
      events.push("database:start");
      return database;
    },
    async startHttp(options) {
      events.push("http:start");
      assert.equal(options.env.PORTAL_RUNTIME_PROFILE, "production");
      assert.equal(options.env.FEATURE_FLAG, "enabled");
      assert.equal(options.env.DB, database.DB);
      return {
        address: { host: "127.0.0.1", port: 3001 },
        async close() { events.push("http:close"); },
      };
    },
  });

  assert.deepEqual(events, ["database:start", "http:start"]);
  assert.equal(application.database, database);
  assert.deepEqual(application.address, { host: "127.0.0.1", port: 3001 });
});

test("HTTP startup failure closes an already opened database and preserves the original error", async () => {
  const events = [];
  const database = fakeRuntimeDatabase(events);
  await assert.rejects(
    () => createRuntimeApplication({
      env: {},
      async createDatabase() {
        events.push("database:start");
        return database;
      },
      async startHttp() {
        events.push("http:start");
        throw new Error("listen failed");
      },
    }),
    /listen failed/u,
  );
  assert.deepEqual(events, ["database:start", "http:start", "database:close"]);
  assert.equal(database.closed, 1);
});

test("database startup failure never attempts HTTP startup", async () => {
  let httpStarts = 0;
  await assert.rejects(
    () => createRuntimeApplication({
      env: {},
      async createDatabase() { throw new Error("schema failed"); },
      async startHttp() { httpStarts += 1; },
    }),
    /schema failed/u,
  );
  assert.equal(httpStarts, 0);
});

test("application close withdraws HTTP before closing DB and is idempotent", async () => {
  const events = [];
  const database = fakeRuntimeDatabase(events);
  const application = await createRuntimeApplication({
    env: {},
    async createDatabase() { return database; },
    async startHttp() {
      return {
        address: null,
        async close() { events.push("http:close"); },
      };
    },
  });

  await application.close();
  await application.close();
  assert.deepEqual(events, ["http:close", "database:close"]);
  assert.equal(database.closed, 1);
});

test("application requires explicit database and HTTP factories", async () => {
  await assert.rejects(() => createRuntimeApplication({ startHttp: async () => ({ close() {} }) }), /createDatabase must be a function/u);
  await assert.rejects(() => createRuntimeApplication({ createDatabase: async () => ({ close() {} }) }), /startHttp must be a function/u);
});
