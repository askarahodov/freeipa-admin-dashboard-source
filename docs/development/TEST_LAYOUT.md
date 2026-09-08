# Test and E2E layout contract

This document defines the target ownership model for `tests/` and `e2e/` under #270. It is a structure contract only: test behavior, coverage, risk categories and assertions remain owned by the existing tests and routing code.

## Current executable discovery

- Node tests are discovered recursively and deterministically by `scripts/discover-node-tests.mjs`.
- `.github/workflows/ci.yml` feeds that shared list into `scripts/ci-test-shards.mjs` for sharding.
- `npm test` uses `scripts/run-node-tests.mjs`, which executes the same discovered list after the production build.
- Recovery keeps additional explicit entrypoints such as `tests/recovery-*.test.mjs` and the dedicated recovery CI job.
- Browser E2E lives under `e2e/specs/` and is routed by `scripts/auth-e2e-scope.mjs`.
- The supported E2E categories remain exactly: `auth`, `rbac`, `freeipa`, `xyops`, `settings`, `ui`.

Recursive discovery is now a prerequisite rather than a blocker for domain subdirectories: moving a Node test still requires a dependency-closed slice, but it must remain visible to the shared discovery helper and existing sharding contracts.

## Target ownership model

The long-term layout is domain-oriented while preserving the distinction between fast Node contracts and browser scenarios.

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
  support/
```

This is a target, not permission for a bulk move. Existing flat paths remain canonical until a dependency-closed migration slice updates scripts, routing contracts and every literal path consumer.

## Migration order

1. Keep Node test discovery recursive and deterministic through the shared helper used by local and CI execution.
2. Preserve contract coverage proving nested files remain discoverable and the current baseline remains covered.
3. Move one coherent Node test family per PR and verify that every moved file remains in CI sharding and local `npm test` discovery.
4. Keep E2E category names stable. Before moving E2E specs into category subdirectories, update `scripts/auth-e2e-scope.mjs`, Playwright paths and routing contract tests in the same PR.
5. Move E2E support files (`freeipa-mock.mjs`, `xyops-mock.mjs`, setup helpers) only after all literal consumers are inventoried; support-file relocation must not broaden browser coverage.

## Required invariants for every migration slice

- No test may become undiscoverable by `npm test` or CI sharding.
- No E2E category may be added, removed or renamed without a separate architecture review.
- `auth`, `rbac`, `freeipa`, `xyops`, `settings`, and `ui` remain the executable risk categories.
- Routing remains owned by `scripts/auth-e2e-scope.mjs`; file moves must update its path rules and `tests/auth-e2e-routing.test.mjs` where applicable.
- Source-reading and literal-path tests must follow the canonical moved path in the same change.
- A migration PR moves one coherent family only; it must not weaken assertions or delete coverage.
- Focused tests, router-selected coverage, lint/build as required by repository policy, and `git diff --check` must pass.

## First implementation slice

Recursive deterministic Node-test discovery is the first implementation slice. It changes only discovery ownership, not test placement or assertions. The next slice may move one coherent Node test family because both local execution and CI sharding now consume the same recursive list.
