import assert from "node:assert/strict";
import test from "node:test";

import { createProductionRuntimeOptions } from "../scripts/start-production.mjs";

test("production entrypoint composes the canonical runtime with one Worker artifact", async () => {
  const calls = [];
  const worker = {
    fetch() {},
    scheduled() {},
  };

  const options = createProductionRuntimeOptions({ env: { PORT: "3001" } });
  assert.equal(typeof options.loadWorker, "function");
  assert.equal(typeof options.startGateway, "function");
  assert.equal(typeof options.createApplication, "function");
  assert.equal(typeof options.createScheduler, "function");
  assert.equal(typeof options.createShutdownCoordinator, "function");

  options.loadWorker = async () => {
    calls.push("loadWorker");
    return worker;
  };
  options.startGateway = async ({ env }) => {
    calls.push(["gateway", env.PORT]);
    return { env: { ...env, IPA_NODE_GATEWAY_URL: "http://127.0.0.1:1", IPA_NODE_GATEWAY_TOKEN: "test-token" }, close: async () => calls.push("gateway.close") };
  };
  options.createApplication = async ({ worker: loadedWorker, env }) => {
    calls.push(["application", loadedWorker === worker, env.IPA_NODE_GATEWAY_TOKEN]);
    return {
      database: { DB: { marker: "db" }, close: async () => calls.push("db.close") },
      http: { close: async () => calls.push("http.close") },
      address: { host: "127.0.0.1", port: 3001 },
    };
  };
  options.createScheduler = ({ worker: scheduledWorker, env, isReady }) => {
    calls.push(["scheduler", scheduledWorker === worker, env.DB.marker, isReady()]);
    return { start: () => calls.push("scheduler.start"), stop: async () => calls.push("scheduler.stop") };
  };
  options.createShutdownCoordinator = (shutdownOptions) => ({
    stop: async () => {
      shutdownOptions.markStopping();
      await shutdownOptions.closeHttp();
      await shutdownOptions.stopScheduler();
      await shutdownOptions.closeGateway();
      await shutdownOptions.closeDatabase();
    },
  });

  const runtime = await options.start(options);
  assert.equal(runtime.worker, worker);
  assert.equal(runtime.ready(), true);
  assert.deepEqual(calls.slice(0, 4), [
    "loadWorker",
    ["gateway", "3001"],
    ["application", true, "test-token"],
    ["scheduler", true, "db", true],
  ]);
  await runtime.stop("SIGTERM");
  assert.equal(runtime.ready(), false);
  assert.deepEqual(calls.slice(-4), ["http.close", "scheduler.stop", "gateway.close", "db.close"]);
});
