# Deterministic CI Test Sharding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute every normal server test exactly once per CI run using at most eight deterministic shards while preserving the merged dependency-audit, SBOM, runtime-image Trivy, build and recovery gates.

**Architecture:** A pure Node helper builds and validates stable test shards. The current security-enabled CI workflow keeps all security jobs intact and changes only generic server-test routing from duplicate full-suite + per-file runners to one shard matrix.

**Tech Stack:** Node.js ESM, `node:test`, GitHub Actions, npm audit/SBOM tooling, pinned Trivy action.

## Global Constraints

- No discovered top-level `tests/*.test.mjs` may be skipped from the normal server-test matrix.
- Each discovered file appears exactly once in that matrix.
- Maximum shard count: 8.
- Keep `--test-concurrency=1` inside each shard.
- Keep `fail-fast: false`.
- Keep `dependency-security` required.
- Keep production CycloneDX SBOM publication required.
- Keep `container-security` and pinned Trivy settings required.
- Keep production dependency-tree validation in build.
- Keep recovery image/volume verification required.
- Keep `CI / Required CI` as the stable aggregate context.
- Do not add retries or security exceptions to make CI green.

---

### Task 1: Deterministic shard builder

**Files:**
- Create: `scripts/ci-test-shards.mjs`
- Create: `tests/ci-test-shards.test.mjs`

**Interfaces:**
- `buildTestShards(paths, maximumShards = 8)`
- `assertCompleteShardCoverage(paths, shards)`

- [ ] Define behavior tests for deterministic sorting/distribution, exact coverage, bounded shard count and fail-closed invalid input.
- [ ] Preserve the original RED evidence from the superseded sharding candidate where the helper did not yet exist.
- [ ] Implement normalization, round-robin grouping and exact coverage validation.
- [ ] Run the focused helper tests and require zero failures.

### Task 2: Integrate shards into the security-enabled workflow

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/auth-e2e-routing.test.mjs`
- Modify: `tests/ci-test-shards.test.mjs`
- Validate: `tests/dependency-security-policy.test.mjs`

- [ ] Remove only the duplicate `test-suite` job.
- [ ] Change discovery output from per-file test JSON to validated shard JSON.
- [ ] Change `matrix.test` to `matrix.shard`.
- [ ] Decode shard files into a shell array and invoke one sequential Node test command per shard.
- [ ] Upload a TAP log per shard.
- [ ] Keep `dependency-security` audit/SBOM steps unchanged.
- [ ] Keep `container-security` pinned Trivy scan unchanged.
- [ ] Keep build dependency-tree validation unchanged.
- [ ] Let recovery depend on build and its own recovery contracts rather than the removed duplicate full suite.
- [ ] Update `Required CI` needs to `[discover-tests, dependency-security, build, container-security, recovery-compose, test]`.
- [ ] Verify both sharding contracts and existing dependency-security policy tests.

### Task 3: Required-check documentation

**Files:**
- Modify: `.github/REQUIRED_CHECKS.md`

- [ ] Document security + sharding composition under the same stable `CI / Required CI` context.
- [ ] Document exact once-only normal server-test membership and independent recovery repetition semantics.
- [ ] Document 14-day SBOM/Trivy security artifacts.
- [ ] State explicitly that sharding cannot weaken audit/Trivy gates.

### Task 4: Exact candidate verification

- [ ] Compare branch against current `main`; require zero commits behind and only the intended seven-file scope.
- [ ] Close stale/superseded sharding PRs; open one current-main replacement PR.
- [ ] Confirm discovery count and exact once-only shard coverage on the candidate snapshot.
- [ ] Confirm GitHub creates no more than eight server shard jobs.
- [ ] Require `Dependency security`, build, all shards, `Runtime image security`, recovery and `CI / Required CI` to succeed on exact head.
- [ ] Require Auth E2E to succeed on exact head with #141 already in base.
- [ ] Merge only with expected head SHA after rechecking current `main` and review threads.

#### Actions incident recovery note — 2026-08-07

GitHub reported and resolved a platform-wide Actions incident on 2026-08-07. The incident report states that some workflow-triggering events were not processed normally and may require an explicit retrigger after recovery. The #151 pre-recovery runs remained queued without receiving a runner even for their first jobs. This documentation-only commit intentionally retriggers the pull-request `synchronize` event after GitHub reported Actions operational again; it does not alter sharding, security, recovery, or required-check behavior. The new exact-head runs are authoritative for Task 4.

### Task 5: Follow-up ownership

- [ ] Keep #60 open for behavior-first test architecture work.
- [ ] Record the measured runner reduction in #60.
- [ ] Replay any later CI/security work on top of the sharded graph rather than restoring duplicate test topology.