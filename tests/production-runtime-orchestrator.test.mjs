import assert from "node:assert/strict";
import test from "node:test";

import { startProductionRuntime } from "../runtime/production-runtime.mjs";

function fakeShutdownCoordinator(options, events) {
  return {
    async stop(signal) {
      options.markStopping();
      await options.closeHttp();
      await options.stopScheduler();
      await options.closeGateway();
      await options.closeDatabase();
      events.push(`shutdown:${signal}`);
      return { status: "stopped", signal };
    },
  };
}

test("production runtime shares one Worker and starts gateway -> app -> scheduler", async () => {
  const events = [];
  const worker = { fetch() {}, scheduled() {} };
  const gateway = {
    env: { BASE: "value", IPA_NODE_GATEWAY_URL: "http://127.0.0.1:4444", IPA_NODE_GATEWAY_TOKEN: "token" },
    async close() { events.push("gateway:close"); },
  };
  const application = {
    database: { DB: { kind: "d1" }, async close() { events.push("database:close"); } },
    http: { async close() { events.push("http:close"); } },
    address: { host: "127.0.0.1", port: 3001 },
  };
  const scheduler = {
    start() { events.push("scheduler:start"); },
    async stop() { events.push("scheduler:stop"); },
  };

  const runtime = await startProductionRuntime({
    env: { BASE: "original" },
    async loadWorker() { events.push("worker:load"); return worker; },
    async startGateway({ env }) {
      events.push("gateway:start");
      assert.equal(env.BASE, "original");
      return gateway;
    },
    async createApplication({ env, worker: appWorker }) {
      events.push("application:start");
      assert.equal(appWorker, worker);
      assert.equal(env.IPA_NODE_GATEWAY_URL, gateway.env.IPA_NODE_GATEWAY_URL);
      return application;
    },
    createScheduler({ worker: scheduledWorker, env, isReady }) {
      events.push("scheduler:create");
      assert.equal(scheduledWorker, worker);
      assert.equal(env.DB, application.database.DB);
      assert.equal(env.IPA_NODE_GATEWAY_TOKEN, gateway.env.IPA_NODE_GATEWAY_TOKEN);
      assert.equal(isReady(), true);
      return scheduler;
    },
    createShutdownCoordinator(options) {
      return fakeShutdownCoordinator(options, events);
    },
  });

  assert.deepEqual(events.slice(0, 5), [
    "worker:load",
    "gateway:start",
    "application:start",
    "scheduler:create",
    "scheduler:start",
  ]);
  assert.equal(runtime.worker, worker);
  assert.equal(runtime.ready(), true);
  assert.deepEqual(runtime.address, application.address);

  await runtime.stop("SIGTERM");
  assert.equal(runtime.ready(), false);
  assert.deepEqual(events.slice(-6), [
    "scheduler:start",
    "http:close",
    "scheduler:stop",
    "gateway:close",
    "database:close",
    "shutdown:SIGTERM",
  ]);
});

test("application startup failure closes the already started gateway", async () => {
  const events = [];
  const gateway = { env: {}, async close() { events.push("gateway:close"); } };

  await assert.rejects(
    () => startProductionRuntime({
      env: {},
      async loadWorker() { return { fetch() {}, scheduled() {} }; },
      async startGateway() { events.push("gateway:start"); return gateway; },
      async createApplication() { events.push("application:start"); throw new Error("application failed"); },
      createScheduler() { throw new Error("must not create scheduler"); },
      createShutdownCoordinator() { throw new Error("must not create shutdown coordinator"); },
    }),
    /application failed/u,
  );
  assert.deepEqual(events, ["gateway:start", "application:start", "gateway:close"]);
});

test("scheduler startup failure closes application resources then gateway", async () => {
  const events = [];
  const application = {
    database: { DB: {}, async close() { events.push("database:close"); } },
    http: { async close() { events.push("http:close"); } },
  };

  await assert.rejects(
    () => startProductionRuntime({
      env: {},
      async loadWorker() { return { fetch() {}, scheduled() {} }; },
      async startGateway() { return { env: {}, async close() { events.push("gateway:close"); } }; },
      async createApplication() { return application; },
      createScheduler() {
        return { start() { throw new Error("scheduler failed"); }, async stop() {} };
      },
      createShutdownCoordinator() { return { stop() {} }; },
    }),
    /scheduler failed/u,
  );
  assert.deepEqual(events, ["http:close", "database:close", "gateway:close"]);
});

test("production runtime requires explicit infrastructure factories", async () => {
  await assert.rejects(() => startProductionRuntime({}), /loadWorker must be a function/u);
});
