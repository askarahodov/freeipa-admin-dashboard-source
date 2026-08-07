# Required GitHub checks

This repository keeps three stable branch-protection contexts for pull requests targeting `main`:

- `CI / Required CI` — aggregate gate over test discovery, lint/build, the complete server suite, recovery-container verification, and the per-file test matrix.
- `Auth E2E / auth-e2e` — always exists for pull requests. It runs a cheap routing contract on every PR and runs the full settings/schema + Chromium suite only when the change can affect runtime, authentication, RBAC, integrations, Docker/deployment, database contracts, or E2E behavior.
- `PR Collision Guard / ownership-collision` — compares the PR's changed files with other open PRs targeting `main`; exact overlap on a canonical/high-conflict ownership surface blocks the PR, while ordinary overlap is informational.

Branch protection for `main` should require all three contexts after the collision workflow is merged. Dynamic matrix job names should not be configured as individual required checks; `CI / Required CI` is the stable aggregate for them.

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

## PR ownership collision guard

The collision guard is a mechanical supplement to the repository's multi-agent ownership rules. It does not replace Issue/PR coordination or `docs/ai/README.md`.

Blocking policy is intentionally small. An exact overlapping file blocks when it is one of the canonical/high-conflict exact owners declared by `scripts/pr-collision-guard.mjs`, or when it lives under a high-conflict prefix such as `db/` or `.github/workflows/`.

Ordinary exact-file overlap outside that policy is reported as `INFO` and does not fail the check. Planning artifacts under `docs/superpowers/**` are therefore nonblocking by themselves.

When the check reports `BLOCKING`, do not bypass or weaken the policy merely to make CI green. Resolve the ownership conflict by doing one of the following:

1. establish explicit PR ordering/dependency;
2. narrow one PR so the canonical owner has only one active implementation;
3. wait for the owning PR to merge and replay the dependent change on current `main`.

The workflow uses only `contents: read` and `pull-requests: read`. It reports PR numbers, titles and overlapping repository paths; it does not read or print other PR bodies, patches, source contents or credentials.

## Concurrency

Obsolete pull-request runs may be cancelled when a newer commit is pushed to the same PR. `main`, manual, and scheduled runs are not cancelled by a newer run; each commit/run retains its own verification evidence.

The collision guard also cancels only obsolete runs for the same PR because every new head must be evaluated against the current set of open PRs.

## Artifacts

Full Auth E2E keeps the existing sanitized Playwright report, test results, and Compose log for 14 days. Documentation-only PRs do not create those heavy artifacts because Chromium is not executed. The normal CI source/build/server-suite artifacts retain their existing short retention policy.
