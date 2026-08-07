import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerScheduler } from "../runtime/worker-scheduler.mjs";

test("worker scheduler calls existing scheduled export with controller and env", async () => {
  const calls = [];
  let backgroundCompleted = false;
  const worker = {
    async scheduled(controller, env, ctx) {
      calls.push({ controller, env });
      ctx.waitUntil(Promise.resolve().then(() => { backgroundCompleted = true; }));
    },
  };

  const scheduler = createWorkerScheduler({
    worker,
    env: { DB: "binding" },
    isReady: async () => true,
    intervalMs: 3_600_000,
    cron: "0 * * * *",
    now: () => 1_765_000_000_000,
  });

  assert.deepEqual(await scheduler.runNow(), { status: "success" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].controller.cron, "0 * * * *");
  assert.equal(calls[0].controller.scheduledTime, 1_765_000_000_000);
  assert.equal(calls[0].env.DB, "binding");
  assert.equal(backgroundCompleted, true);
});

test("worker scheduler does not call scheduled export while unready", async () => {
  let calls = 0;
  const scheduler = createWorkerScheduler({
    worker: { async scheduled() { calls += 1; } },
    env: {},
    isReady: async () => false,
    intervalMs: 3_600_000,
  });

  assert.deepEqual(await scheduler.runNow(), { status: "skipped", reason: "unready" });
  assert.equal(calls, 0);
});

test("worker scheduler requires a scheduled export", () => {
  assert.throws(
    () => createWorkerScheduler({ worker: {}, env: {}, intervalMs: 3_600_000 }),
    /scheduled handler/u,
  );
});
