# Deterministic CI Test Sharding Design

## Context

Issue #60 requires a behavior-first test pyramid with bounded CI runtime. Before this work the pull-request workflow executes the complete top-level `tests/*.test.mjs` suite once and then launches one additional matrix job per test file. The original measured baseline contained 187 top-level test files; production dependency-security work merged afterward and may add more tests, so current discovery rather than a hard-coded count is authoritative.

Several AI agents work concurrently, so the duplicate complete-suite + per-file topology can saturate hosted runners and delay every PR. Production dependency security is now also a required part of `main`, therefore test sharding must preserve the merged audit, SBOM and runtime-image Trivy gates rather than replaying the older CI file.

## Decision

Replace only the duplicate server-test topology with **one deterministic sharded pass** while retaining every current security/build/recovery boundary.

- Every discovered top-level `tests/*.test.mjs` appears in exactly one normal server-test shard.
- Use at most 8 shards.
- Normalize, sort and distribute paths round-robin for deterministic, balanced membership.
- Run each shard with `--test-concurrency=1`.
- Keep `fail-fast: false` so one shard does not hide failures in another.
- Preserve `dependency-security`, production audit, CycloneDX SBOM, `container-security` and pinned Trivy exactly as required gates.
- Preserve the production dependency-tree validation in `build`.
- Preserve the independent recovery image/volume gate.
- Keep `CI / Required CI` as the stable aggregate context.

Recovery-specific contract files can execute again in the recovery job because that boundary proves container/image/volume behavior in addition to ordinary server behavior. The removed duplication is the second generic complete server suite, not domain-specific verification.

## Components

### `scripts/ci-test-shards.mjs`

Pure functions:

- `buildTestShards(paths, maximumShards = 8)`
- `assertCompleteShardCoverage(paths, shards)`

The builder normalizes, deduplicates and sorts test paths, chooses `min(maximumShards, testCount)` shards, then assigns each sorted path by index modulo shard count.

```js
{ name: "01", files: ["tests/a.test.mjs", "tests/i.test.mjs"] }
```

Coverage validation rejects missing, duplicate or unexpected shard membership. Empty discovery and invalid shard counts fail closed.

The CLI reads an explicitly discovered newline-separated file list and emits GitHub Actions JSON plus the discovered count. It does not call GitHub or inspect repository ownership.

### `.github/workflows/ci.yml`

The existing security jobs remain owners of their contracts:

- `dependency-security` — production audit + SBOM;
- `container-security` — pinned Trivy runtime-image scan;
- `build` — dependency install/tree validation, lint, build.

Only server-test routing changes:

- `discover-tests` emits validated `shards` JSON;
- `test-suite` is removed;
- `test` uses `matrix.shard` rather than `matrix.test`;
- one Node test command receives all files in a shard;
- each shard uploads a TAP log;
- `recovery-compose` may start after build because it owns its own recovery contracts;
- `Required CI` waits for discovery, dependency security, build, container security, recovery and all test shards.

## Failure semantics

- No discovered tests: fail.
- Invalid shard count: fail.
- Missing/duplicate/unexpected shard membership: fail before matrix execution.
- Any failed shard: aggregate test result fails.
- Failed audit/SBOM, build, Trivy or recovery: `Required CI` fails exactly as before.
- No security allowlist, Trivy severity or retry behavior is weakened by sharding.

## Test strategy

Behavior tests prove deterministic distribution, exact coverage, duplicate-input normalization, bounded shard count and fail-closed validation.

Workflow contracts prove:

- no duplicate `test-suite` job;
- maximum 8 shards;
- `--test-concurrency=1` inside shards;
- per-shard TAP artifacts;
- `dependency-security` still runs audit/SBOM;
- `container-security` still uses the pinned Trivy action;
- stable aggregate needs include security + build + recovery + shards.

The existing dependency-security policy tests remain authoritative for patched dependency versions, audit/SBOM semantics and Trivy settings.

## Integration history

The first sharding candidate proved the topology on GitHub: all discovered tests were assigned exactly once, GitHub created eight shard jobs, and the aggregate server/recovery CI succeeded. Its Auth E2E failure was the independent OperationExplorer/legacy-read-model race fixed by #141. Before that candidate could merge, #101 merged the security gates into `main`. This design therefore requires a fresh replay from the security-enabled `main`, not a merge of either stale branch.

## Scope boundary

This slice does not complete #60. It does not yet replace source-text guards with runtime behavior tests, classify unit/integration/database suites, or create the future standalone runtime harness. It only removes the generic duplicate runner explosion while preserving all current required tests and security gates.