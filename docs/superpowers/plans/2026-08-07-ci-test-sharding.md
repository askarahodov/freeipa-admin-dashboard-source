# Deterministic CI Test Sharding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute every server test exactly once per CI run using a small deterministic shard matrix instead of a duplicate full suite plus one runner per test file.

**Architecture:** A pure Node helper builds and validates up to eight stable test shards. The CI workflow discovers test paths, delegates grouping/coverage validation to the helper, and runs one sequential Node test command per shard while preserving recovery and the stable aggregate required check.

**Tech Stack:** Node.js ESM, `node:test`, GitHub Actions, Bash/JQ only for simple workflow plumbing.

## Global Constraints

- No existing `tests/*.test.mjs` may be skipped.
- Each discovered test file must execute exactly once in the server-test matrix.
- Maximum shard count: 8.
- Keep `--test-concurrency=1` inside each shard.
- Keep `fail-fast: false`.
- Keep `CI / Required CI` as the stable aggregate context.
- Keep recovery container/volume verification required.
- Do not add retries to make failures green.

---

### Task 1: Shard builder and coverage validator

**Files:**
- Create: `scripts/ci-test-shards.mjs`
- Create: `tests/ci-test-shards.test.mjs`

**Interfaces:**
- `buildTestShards(paths, maximumShards = 8)`
- `assertCompleteShardCoverage(paths, shards)`

- [ ] Write failing tests for deterministic distribution, exact coverage and invalid input.
- [ ] Run `node --test tests/ci-test-shards.test.mjs` and verify missing-module RED.
- [ ] Implement minimal normalization, round-robin grouping and coverage validation.
- [ ] Rerun focused tests and require zero failures.

### Task 2: Sharded CI workflow

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/auth-e2e-routing.test.mjs`
- Modify: `tests/ci-test-shards.test.mjs`

- [ ] Add workflow contract that rejects the duplicate `test-suite` job and requires shard matrix semantics.
- [ ] Verify contract RED against current workflow.
- [ ] Change `discover-tests` output from per-file matrix input to validated shard JSON.
- [ ] Replace `matrix.test` with `matrix.shard`.
- [ ] Decode the shard file JSON safely and pass files as shell array arguments to Node.
- [ ] Write/upload one TAP log per shard.
- [ ] Let recovery depend on build and its own contracts, not duplicate full suite.
- [ ] Update `Required CI` dependencies to `[discover-tests, build, recovery-compose, test]` and matching result variables.
- [ ] Rerun focused workflow contracts.

### Task 3: Candidate verification

- [ ] Compare branch with current `main`; clean replay if another agent changed `ci.yml` first.
- [ ] Open a draft PR as a partial implementation of #60.
- [ ] Verify build/lint and all shard jobs on exact head.
- [ ] Confirm discovery reports all current test files with exact once-only coverage.
- [ ] Confirm aggregate `CI / Required CI` succeeds.
- [ ] Confirm Auth E2E routing remains stable.
- [ ] Keep #60 open for behavior-first runtime/database test architecture work after this efficiency slice.