# Deterministic CI Test Sharding Design

## Context

Issue #60 requires a behavior-first test pyramid with bounded CI runtime. The current PR CI discovers every `tests/*.test.mjs`, runs all files once in `Test complete server suite`, and then launches one separate matrix job per file. At the current repository size this means 187 per-file jobs plus the duplicate full-suite execution for every PR. With several AI agents opening PRs concurrently, runner queue time now dominates verification latency.

## Decision

Replace duplicate full-suite + per-file matrix execution with **one deterministic sharded pass** over all discovered server tests.

- Every `tests/*.test.mjs` file appears in exactly one shard.
- Use at most 8 shards.
- Discovery sorts paths first, then distributes them round-robin to keep shard file counts balanced and deterministic.
- Each shard runs all of its files in one Node test command with `--test-concurrency=1`.
- Shards run in parallel on independent GitHub runners, preserving filesystem/process isolation across shards.
- Recovery container/volume verification remains a separate required job.
- `CI / Required CI` remains the stable aggregate check.

This reduces the normal server-test runner fan-out from 188 executions (1 full + 187 per-file) to 8 shard jobs while preserving one execution of every test file.

## Components

### `scripts/ci-test-shards.mjs`

Pure functions:

- `buildTestShards(paths, maximumShards = 8)`
- `assertCompleteShardCoverage(paths, shards)`

The builder normalizes, deduplicates and sorts test paths, chooses `min(maximumShards, testCount)` shards, distributes paths by sorted index modulo shard count, and returns stable objects:

```js
{ name: "01", files: ["tests/a.test.mjs", "tests/i.test.mjs"] }
```

The coverage assertion fails if any source test is missing, duplicated across shards or if an unexpected file appears.

The CLI discovers no files itself. CI supplies the sorted newline-separated file list, so file discovery remains explicit in the workflow.

### `.github/workflows/ci.yml`

`discover-tests` emits `shards` JSON rather than an entry for every file. The test matrix is keyed by `matrix.shard` and invokes one Node command with all files in that shard.

Each shard writes and uploads a TAP log. The old `test-suite` job is removed because it is duplicate execution, not an additional behavior layer.

`recovery-compose` may start after `build` rather than waiting for all server tests because it runs its own recovery contracts and isolated image/volume smoke. `Required CI` still waits for both sharded tests and recovery.

## Failure semantics

- Empty discovery is an error.
- Invalid shard count is an error.
- Coverage verification runs during discovery before matrix creation.
- A failed shard fails the aggregate `test` matrix result.
- `Required CI` fails if discovery, build, any shard, or recovery fails.
- `fail-fast: false` is retained so one failing shard does not hide failures in other shards.

## Test strategy

Behavior tests for the shard builder prove:

- stable sorting and round-robin distribution;
- no more shards than files;
- exact once-only coverage;
- duplicate input normalization;
- invalid/empty inputs fail closed;
- deliberate missing/duplicate/unexpected coverage is rejected.

Workflow source contract proves:

- no `test-suite` duplicate job remains;
- `discover-tests` creates shard JSON;
- matrix uses `matrix.shard`;
- shard execution retains `--test-concurrency=1`;
- shard TAP logs are uploaded;
- `Required CI` waits for discovery, build, recovery and test shards.

## Scope boundary

This slice does not yet classify unit/source-guard/API/DB tests or build the future real-runtime harness required by the rest of #60. It only removes the current duplicate runner explosion without dropping any existing test file. #60 remains open after this merge.