import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCompleteShardCoverage,
  buildTestShards,
} from "../../scripts/ci-test-shards.mjs";

const ciWorkflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

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

test("8 4 and 2 shard candidates are deterministic non-empty and exact-once", () => {
  const inventory = Array.from(
    { length: 41 },
    (_, index) => `tests/server/case-${String(index + 1).padStart(2, "0")}.test.mjs`,
  );

  for (const maximumShards of [8, 4, 2]) {
    const first = buildTestShards(inventory, maximumShards);
    const reordered = buildTestShards([...inventory].reverse(), maximumShards);
    const flattened = first.flatMap((shard) => shard.files);

    assert.deepEqual(first, reordered, `${maximumShards} shards must be deterministic`);
    assert.equal(first.length, maximumShards);
    assert.ok(first.every((shard) => shard.files.length > 0), `${maximumShards} shards must not contain an empty shard`);
    assert.equal(flattened.length, inventory.length);
    assert.equal(new Set(flattened).size, inventory.length);
    assert.doesNotThrow(() => assertCompleteShardCoverage(inventory, first));
  }
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

test("CI runs one validated sharded server-test pass and preserves all security gates", () => {
  assert.doesNotMatch(ciWorkflow, /\n  test-suite:\n/u);
  assert.match(ciWorkflow, /outputs:\s*\n\s+shards:\s*\$\{\{ steps\.list\.outputs\.shards \}\}/u);
  assert.match(ciWorkflow, /scripts\/ci-test-shards\.mjs/u);
  assert.match(ciWorkflow, /--max-shards\s+8/u);
  assert.match(ciWorkflow, /name:\s*Test shard \$\{\{ matrix\.shard\.name \}\}/u);
  assert.match(ciWorkflow, /strategy:\s*\n\s+fail-fast:\s*false/u);
  assert.match(ciWorkflow, /shard:\s*\$\{\{ fromJSON\(needs\.discover-tests\.outputs\.shards\) \}\}/u);
  assert.match(ciWorkflow, /TEST_FILES_JSON:\s*\$\{\{ toJSON\(matrix\.shard\.files\) \}\}/u);
  assert.match(ciWorkflow, /--test-concurrency=1/u);
  assert.match(ciWorkflow, /server-shard-\$\{SHARD_NAME\}\.tap/u);
  assert.match(ciWorkflow, /server-shard-\$\{\{ matrix\.shard\.name \}\}-log/u);
  assert.match(ciWorkflow, /recovery-compose:[\s\S]*?needs:\s*\[plan, build\]/u);

  assert.match(ciWorkflow, /\n  docs-consistency:\n/u);
  assert.match(ciWorkflow, /npm run docs:check/u);
  assert.match(ciWorkflow, /\n  dependency-security:\n/u);
  assert.match(ciWorkflow, /npm run security:audit/u);
  assert.match(ciWorkflow, /security:sbom/u);
  assert.match(ciWorkflow, /\n  container-security:\n/u);
  assert.match(ciWorkflow, /aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25/u);
  assert.match(ciWorkflow, /needs:\s*\[plan, discover-tests, docs-consistency, dependency-security, build, container-security, recovery-compose, test\]/u);
  assert.match(ciWorkflow, /DOCS_RESULT:\s*\$\{\{ needs\.docs-consistency\.result \}\}/u);
  assert.match(ciWorkflow, /SECURITY_RESULT:\s*\$\{\{ needs\.dependency-security\.result \}\}/u);
  assert.match(ciWorkflow, /CONTAINER_RESULT:\s*\$\{\{ needs\.container-security\.result \}\}/u);
  assert.match(ciWorkflow, /PLAN_RESULT:\s*\$\{\{ needs\.plan\.result \}\}/u);
  assert.match(ciWorkflow, /node scripts\/ci-required-gate\.mjs/u);
});
