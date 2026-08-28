import assert from "node:assert/strict";
import test from "node:test";

import { resolveLegacyOperationTarget } from "../src/operations/operation-explorer-legacy-bridge.ts";

test("existing legacy target returns immediately without refresh or wait", async () => {
  const target = { id: "legacy-row" };
  let refreshes = 0;
  let waits = 0;

  const result = await resolveLegacyOperationTarget({
    find: () => target,
    refresh: () => { refreshes += 1; },
    wait: async () => { waits += 1; return null; },
  });

  assert.equal(result, target);
  assert.equal(refreshes, 0);
  assert.equal(waits, 0);
});

test("missing legacy target refreshes once and returns the observed target", async () => {
  const target = { id: "refreshed-row" };
  const calls = [];

  const result = await resolveLegacyOperationTarget({
    find: () => null,
    refresh: () => { calls.push("refresh"); },
    wait: async () => { calls.push("wait"); return target; },
  });

  assert.equal(result, target);
  assert.deepEqual(calls, ["refresh", "wait"]);
});

test("missing target stays null after one refresh and one bounded observation", async () => {
  let refreshes = 0;
  let waits = 0;

  const result = await resolveLegacyOperationTarget({
    find: () => null,
    refresh: async () => { refreshes += 1; },
    wait: async () => { waits += 1; return null; },
  });

  assert.equal(result, null);
  assert.equal(refreshes, 1);
  assert.equal(waits, 1);
});
