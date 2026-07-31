import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPortalSchemaV2CacheForTests,
  coalescePortalSchemaV2Ensure,
} from "../db/portal-migrations-v2.ts";

function ready(verifiedAt = 1_000) {
  return {
    state: "ready",
    currentVersion: 2,
    latestVersion: 2,
    appliedVersions: [1, 2],
    pendingVersions: [],
    compatibleDrift: [],
    incompatibleDrift: [],
    errorCode: "",
    verifiedAt,
  };
}

test.beforeEach(() => clearPortalSchemaV2CacheForTests());

test("coalesces concurrent production v2 readiness and caches only ready results", async () => {
  const database = {};
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runner = async () => {
    calls += 1;
    await gate;
    return ready();
  };

  const first = coalescePortalSchemaV2Ensure(database, runner, { now: () => 1_000 });
  const second = coalescePortalSchemaV2Ensure(database, runner, { now: () => 1_000 });
  assert.equal(first, second);
  assert.equal(calls, 1);

  release();
  assert.deepEqual(await first, ready());
  assert.deepEqual(await second, ready());

  const cached = await coalescePortalSchemaV2Ensure(database, async () => {
    calls += 1;
    return ready(2_000);
  }, { now: () => 2_000 });
  assert.equal(calls, 1);
  assert.equal(cached.verifiedAt, 2_000);
});

test("does not cache busy or failed readiness", async () => {
  const database = {};
  let calls = 0;
  const busy = { ...ready(), state: "busy", errorCode: "schema_migration_busy" };
  const failed = { ...ready(), state: "failed", errorCode: "schema_migration_failed" };

  assert.equal((await coalescePortalSchemaV2Ensure(database, async () => {
    calls += 1;
    return busy;
  })).state, "busy");
  assert.equal((await coalescePortalSchemaV2Ensure(database, async () => {
    calls += 1;
    return failed;
  })).state, "failed");
  assert.equal(calls, 2);
});
