# Test and E2E layout contract

This document defines the target ownership model for `tests/` and `e2e/` under #270. It is a structure contract only: test behavior, coverage, risk categories and assertions remain owned by the existing tests and routing code.

## Current executable discovery

- Node tests are discovered recursively and deterministically by `scripts/discover-node-tests.mjs`.
- `.github/workflows/ci.yml` feeds that shared list into `scripts/ci-test-shards.mjs` for sharding.
- `npm test` uses `scripts/run-node-tests.mjs`, which executes the same recursive list after the production build.
- Recovery contracts live under `tests/recovery/`, with the dedicated recovery CI job preserving its additional container/volume checks.
- Browser E2E lives under `e2e/specs/<category>/` and is routed by `scripts/auth-e2e-scope.mjs`.
- Integration mock servers live under `e2e/fixtures/`; `e2e/support/` remains reserved for shared browser helpers when such helpers are introduced.
- The supported E2E categories remain exactly: `auth`, `rbac`, `freeipa`, `xyops`, `settings`, `ui`.

Recursive discovery is the stable execution contract for domain subdirectories: moved Node tests remain visible to the shared discovery helper and existing sharding contracts.

## Target ownership model

The normalized layout is domain-oriented while preserving the distinction between fast Node contracts and browser scenarios.

```text
tests/
  architecture/
  auth/
  backup/
  documentation/
  freeipa/
  operations/
  recovery/
  runtime/
  security/
  settings/
  storage/
  ui/
  xyops/

e2e/
  specs/
    auth/
    rbac/
    freeipa/
    xyops/
    settings/
    ui/
  fixtures/
  support/  # reserved until shared support helpers exist
```

Node tests now use the domain owners above. Browser specs use the six category directories above, and integration mocks use `e2e/fixtures/`. Future structural moves must remain dependency-closed and update scripts, routing contracts and every literal path consumer in the same change.

## Migration order

1. Keep Node test discovery recursive and deterministic through the shared helper used by local and CI execution.
2. Preserve contract coverage proving nested files remain discoverable and the current baseline remains covered.
3. Keep Node tests under their canonical domain owner directories and verify that every moved file remains in CI sharding and local `npm test` discovery.
4. Keep E2E category names stable and update `scripts/auth-e2e-scope.mjs`, Playwright paths and routing contract tests together whenever browser paths change.
5. Keep E2E integration mocks under `e2e/fixtures/`; any future shared support helpers belong under `e2e/support/` and must be moved with all literal consumers.

## Required invariants for every migration slice

- No test may become undiscoverable by `npm test` or CI sharding.
- No E2E category may be added, removed or renamed without a separate architecture review.
- `auth`, `rbac`, `freeipa`, `xyops`, `settings`, and `ui` remain the executable risk categories.
- Routing remains owned by `scripts/auth-e2e-scope.mjs`; file moves must update its path rules and `tests/auth/auth-e2e-routing.test.mjs` where applicable.
- Source-reading and literal-path tests must follow the canonical moved path in the same change.
- A migration PR moves one coherent family only; it must not weaken assertions or delete coverage.
- Focused tests, router-selected coverage, lint/build as required by repository policy, and `git diff --check` must pass.

## Completion state

The #270 normalization is complete: Node tests are organized under canonical domain owners, browser specs are organized by the six stable E2E categories, integration mock servers are under `e2e/fixtures/`, and local/CI execution continues to share recursive deterministic discovery and risk-based E2E routing. `e2e/support/` is intentionally not materialized while there are no shared support helpers to own.
