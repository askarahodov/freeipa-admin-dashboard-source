import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCompleteShardCoverage,
  buildTestShards,
} from "../scripts/ci-test-shards.mjs";

test("builds deterministic round-robin shards from normalized sorted paths", () => {
  const shards = buildTestShards([
    "tests/d.test.mjs",
    "./tests/b.test.mjs",
    "tests/a.test.mjs",
    "tests/c.test.mjs",
    "tests/b.test.mjs",
  ], 2);

  assert.deepEqual(shards, [
    { name: "01", files: ["tests/a.test.mjs", "tests/c.test.mjs"] },
    { name: "02", files: ["tests/b.test.mjs", "tests/d.test.mjs"] },
  ]);
  assert.doesNotThrow(() => assertCompleteShardCoverage([
    "tests/a.test.mjs",
    "tests/b.test.mjs",
    "tests/c.test.mjs",
    "tests/d.test.mjs",
  ], shards));
});

test("never creates more shards than discovered test files", () => {
  assert.deepEqual(buildTestShards(["tests/a.test.mjs", "tests/b.test.mjs"], 8), [
    { name: "01", files: ["tests/a.test.mjs"] },
    { name: "02", files: ["tests/b.test.mjs"] },
  ]);
});

test("fails closed for empty discovery or invalid shard count", () => {
  assert.throws(() => buildTestShards([], 8), /No test files discovered/u);
  assert.throws(() => buildTestShards(["tests/a.test.mjs"], 0), /maximumShards/u);
  assert.throws(() => buildTestShards(["tests/a.test.mjs"], 1.5), /maximumShards/u);
});

test("coverage validator rejects missing duplicate and unexpected shard entries", () => {
  const source = ["tests/a.test.mjs", "tests/b.test.mjs"];

  assert.throws(
    () => assertCompleteShardCoverage(source, [{ name: "01", files: ["tests/a.test.mjs"] }]),
    /missing.*tests\/b\.test\.mjs/isu,
  );
  assert.throws(
    () => assertCompleteShardCoverage(source, [
      { name: "01", files: ["tests/a.test.mjs"] },
      { name: "02", files: ["tests/a.test.mjs", "tests/b.test.mjs"] },
    ]),
    /duplicate.*tests\/a\.test\.mjs/isu,
  );
  assert.throws(
    () => assertCompleteShardCoverage(source, [
      { name: "01", files: ["tests/a.test.mjs", "tests/b.test.mjs", "tests/c.test.mjs"] },
    ]),
    /unexpected.*tests\/c\.test\.mjs/isu,
  );
});
