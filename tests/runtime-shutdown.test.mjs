import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeShutdownCoordinator } from "../runtime/shutdown.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("shutdown withdraws readiness before closing runtime dependencies in order", async () => {
  const events = [];
  const coordinator = createRuntimeShutdownCoordinator({
    markStopping: () => events.push("stopping"),
    closeHttp: async () => events.push("http"),
    stopScheduler: async () => events.push("scheduler"),
    closeGateway: async () => events.push("gateway"),
    closeDatabase: async () => events.push("database"),
    timeoutMs: 1000,
  });

  const result = await coordinator.stop("SIGTERM");
  assert.deepEqual(events, ["stopping", "http", "scheduler", "gateway", "database"]);
  assert.deepEqual(result, { status: "stopped", signal: "SIGTERM" });
});

test("concurrent stop calls share one shutdown execution", async () => {
  const gate = deferred();
  let closeCalls = 0;
  const coordinator = createRuntimeShutdownCoordinator({
    markStopping() {},
    async closeHttp() { closeCalls += 1; await gate.promise; },
    async stopScheduler() {},
    async closeGateway() {},
    async closeDatabase() {},
    timeoutMs: 1000,
  });

  const first = coordinator.stop("SIGTERM");
  const second = coordinator.stop("SIGINT");
  gate.resolve();
  assert.equal(first, second);
  await first;
  assert.equal(closeCalls, 1);
});

test("shutdown timeout fails closed and does not report a clean stop", async () => {
  const never = new Promise(() => {});
  const coordinator = createRuntimeShutdownCoordinator({
    markStopping() {},
    closeHttp: async () => never,
    async stopScheduler() {},
    async closeGateway() {},
    async closeDatabase() {},
    timeoutMs: 20,
  });

  await assert.rejects(() => coordinator.stop("SIGTERM"), /shutdown timed out/u);
});

test("cleanup failure is surfaced after readiness withdrawal", async () => {
  let stopping = false;
  const coordinator = createRuntimeShutdownCoordinator({
    markStopping() { stopping = true; },
    async closeHttp() {},
    async stopScheduler() { throw new Error("scheduler close failed"); },
    async closeGateway() {},
    async closeDatabase() {},
    timeoutMs: 1000,
  });

  await assert.rejects(() => coordinator.stop("SIGTERM"), /scheduler close failed/u);
  assert.equal(stopping, true);
});
