import assert from "node:assert/strict";
import test from "node:test";

import { createNonOverlappingScheduler } from "../runtime/scheduler.mjs";

test("scheduler skips work while runtime is not ready", async () => {
  let runs = 0;
  const scheduler = createNonOverlappingScheduler({
    intervalMs: 60_000,
    isReady: async () => false,
    run: async () => { runs += 1; },
  });

  const result = await scheduler.runNow();
  assert.deepEqual(result, { status: "skipped", reason: "unready" });
  assert.equal(runs, 0);
});

test("scheduler prevents overlapping executions", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const scheduler = createNonOverlappingScheduler({
    intervalMs: 60_000,
    isReady: async () => true,
    run: async () => blocked,
  });

  const first = scheduler.runNow();
  await Promise.resolve();
  const overlap = await scheduler.runNow();
  assert.deepEqual(overlap, { status: "skipped", reason: "overlap" });
  release();
  assert.deepEqual(await first, { status: "success" });
});

test("failed execution does not poison later runs", async () => {
  let attempts = 0;
  const scheduler = createNonOverlappingScheduler({
    intervalMs: 60_000,
    isReady: async () => true,
    run: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("upstream detail must not leak");
    },
  });

  assert.deepEqual(await scheduler.runNow(), { status: "failed" });
  assert.deepEqual(await scheduler.runNow(), { status: "success" });
  assert.equal(scheduler.status().lastOutcome, "success");
  assert.equal("error" in scheduler.status(), false);
});

test("stop clears pending timer and waits for active work", async () => {
  let scheduledCallback;
  let cleared = false;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const scheduler = createNonOverlappingScheduler({
    intervalMs: 60_000,
    isReady: async () => true,
    run: async () => blocked,
    setTimer(callback) {
      scheduledCallback = callback;
      return { id: 1 };
    },
    clearTimer() {
      cleared = true;
    },
  });

  scheduler.start();
  assert.equal(typeof scheduledCallback, "function");
  const running = scheduler.runNow();
  await Promise.resolve();
  const stopping = scheduler.stop();
  assert.equal(cleared, true);
  release();
  assert.deepEqual(await running, { status: "success" });
  await stopping;
  assert.equal(scheduler.status().started, false);
});
