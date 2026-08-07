# Required GitHub checks

This repository keeps two stable branch-protection contexts for pull requests targeting `main`:

- `CI / Required CI` — aggregate gate over test discovery/shard validation, lint/build, all deterministic server-test shards, and recovery-container verification.
- `Auth E2E / auth-e2e` — always exists for pull requests. It runs a cheap routing contract on every PR and runs the full settings/schema + Chromium suite only when the change can affect runtime, authentication, RBAC, integrations, Docker/deployment, database contracts, or E2E behavior.

Branch protection for `main` should require both contexts. Dynamic shard job names should not be configured as individual required checks; `CI / Required CI` is the stable aggregate for them.

## Server test sharding

`discover-tests` finds every top-level `tests/*.test.mjs`, then `scripts/ci-test-shards.mjs` normalizes, sorts and validates exact once-only membership in at most eight deterministic shards.

Each shard runs its assigned files with `--test-concurrency=1` and uploads a short-lived TAP log. The repository does not run the same complete server suite a second time merely to duplicate matrix coverage. Missing, duplicated or unexpected shard membership fails discovery before the matrix runs.

Recovery container/image/volume verification remains an independent required job and may run in parallel with server-test shards after the build succeeds. `CI / Required CI` waits for discovery, build, every shard and recovery before succeeding.

## Auth E2E routing matrix

| Representative change | Stable Auth E2E check | Chromium |
| --- | --- | --- |
| `local-auth.ts`, auth/RBAC/security middleware | yes | full |
| `app/**`, `worker/**`, `db/**` | yes | full |
| FreeIPA/XYOps runtime or E2E specs | yes | full |
| `Dockerfile`, Compose, env examples, startup scripts | yes | full |
| `package.json`, `package-lock.json`, Vite config | yes | full |
| `tests/**` or Auth E2E workflow/routing logic | yes | full |
| documentation-only change | yes | skipped after routing contract |
| push to `main` | yes | full |
| manual dispatch | yes | full |
| weekly scheduled run | yes | full |

The canonical path classifier is `scripts/auth-e2e-scope.mjs`. `tests/auth-e2e-routing.test.mjs` verifies representative security/runtime paths, validates every exact path registered by the classifier, and protects workflow trigger/concurrency semantics.

## Concurrency

Obsolete pull-request runs may be cancelled when a newer commit is pushed to the same PR. `main`, manual, and scheduled runs are not cancelled by a newer run; each commit/run retains its own verification evidence.

## Artifacts

Full Auth E2E keeps the existing sanitized Playwright report, test results, and Compose log for 14 days. Documentation-only PRs do not create those heavy artifacts because Chromium is not executed. The normal CI source/build/shard artifacts retain their existing short retention policy.
