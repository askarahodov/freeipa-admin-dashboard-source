# Test and E2E layout contract

This document defines the target ownership model for `tests/` and `e2e/` under #270. It is a structure contract only: test behavior, coverage, risk categories and assertions remain owned by the existing tests and routing code.

## Current executable discovery

- Node tests are discovered by `.github/workflows/ci.yml` with `find tests -maxdepth 1 -name '*.test.mjs'` and then sharded by `scripts/ci-test-shards.mjs`.
- `npm test` also executes only `tests/*.test.mjs` after the production build.
- Recovery has additional explicit entrypoints such as `tests/recovery-*.test.mjs` and the dedicated recovery CI job.
- Browser E2E lives under `e2e/specs/` and is routed by `scripts/auth-e2e-scope.mjs`.
- The supported E2E categories remain exactly: `auth`, `rbac`, `freeipa`, `xyops`, `settings`, `ui`.

Because discovery is currently flat, moving a Node test into a subdirectory before changing both local and CI discovery would silently remove it from normal coverage. Such moves are forbidden.

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

This is a target, not permission for a bulk move. Existing flat paths remain canonical until a dependency-closed migration slice updates discovery, scripts, routing contracts and every literal path consumer.

## Migration order

1. Make Node test discovery recursive and deterministic without changing the executed test set.
2. Add contract coverage proving that recursive discovery sees the same baseline set before any test is moved.
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

## First implementation slice after this design

The safest first implementation is discovery-only: replace flat `tests/*.test.mjs` / `find tests -maxdepth 1` assumptions with one shared deterministic recursive test-file discovery contract while keeping every test at its current path. Only after that gate is green should the first domain family be moved.
