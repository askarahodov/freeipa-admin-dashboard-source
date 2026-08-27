# Required GitHub checks

This repository keeps three stable branch-protection contexts for pull requests targeting `main`:

- `CI / Required CI` — aggregate gate over deterministic test discovery/shard validation, production dependency audit + SBOM, lint/build, runtime-image Trivy scanning, all server-test shards, and recovery-container verification.
- `Auth E2E / auth-e2e` — always exists for pull requests. It runs a cheap routing contract on every PR and runs the full settings/schema + Chromium suite only when the change can affect runtime, authentication, RBAC, integrations, Docker/deployment, database contracts, or E2E behavior.
- `PR Collision Guard / ownership-collision` — read-only ownership gate that compares exact changed paths with other open PRs targeting `main`; exact overlap on canonical/high-conflict ownership surfaces blocks until merge order or ownership is resolved.

Branch protection for `main` should require all three contexts. Dynamic shard job names should not be configured as individual required checks; `CI / Required CI` is the stable aggregate for them.

## Required CI composition

`CI / Required CI` waits for all of these independent boundaries:

1. `discover-tests` — finds every top-level `tests/*.test.mjs` and validates exact once-only membership in at most eight deterministic shards;
2. `dependency-security` — enforces the production dependency audit policy and publishes a production CycloneDX SBOM;
3. `build` — installs dependencies, validates the production dependency tree, lints and builds the product;
4. `container-security` — builds the final runtime image and scans fixable HIGH/CRITICAL vulnerabilities with the pinned Trivy action;
5. `test` — executes every discovered server test exactly once in the normal server-test matrix, using `--test-concurrency=1` inside each shard;
6. `recovery-compose` — verifies recovery contracts, the isolated recovery image and disposable named-volume smoke.

A failure in any one of those boundaries fails the stable aggregate check.

## Server test sharding

`scripts/ci-test-shards.mjs` normalizes and sorts discovered test paths, distributes them round-robin into at most eight shards, and fails closed if shard membership contains a missing, duplicate or unexpected test file.

Each shard uploads its own short-lived TAP log. The repository does not run a second complete server suite merely to duplicate the matrix coverage. Recovery contracts may also appear in the independent recovery gate because that job proves container/volume behavior in addition to ordinary server-test execution.

## Security artifacts

The dependency-security job retains the production CycloneDX SBOM for 14 days. Runtime-image Trivy JSON is also retained for 14 days. Sharding must never remove, bypass or downgrade either security gate.

## PR ownership collision guard

`scripts/pr-collision-guard.mjs` is the canonical policy/analyzer for the stable `PR Collision Guard / ownership-collision` check. The workflow has only `contents: read` and `pull-requests: read` permissions and evaluates open PRs targeting `main`.

Collision severity is based on an **exact shared changed path**:

- `BLOCKING` — the exact overlapping path is a canonical/high-conflict owner (for example `app/page.tsx`, `worker/index.ts`, package manifests, canonical security/architecture docs, `db/**`, or `.github/workflows/**`);
- `INFO` — the exact overlap is outside the blocking policy and is surfaced for coordination without failing the check.

Planning artifacts under `docs/superpowers/**` are nonblocking by themselves. Closed PRs, stacked PRs not targeting `main`, and the current PR itself are excluded.

A blocking collision must be resolved by establishing explicit merge/dependency order, narrowing one PR's scope, or replaying the later PR after the owning PR merges. Do not bypass the guard by weakening the high-conflict policy merely to make CI green.

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

Full Auth E2E keeps the existing sanitized Playwright report, test results, and Compose log for 14 days. Documentation-only PRs do not create those heavy artifacts because Chromium is not executed. Normal CI source/build/shard artifacts retain the existing short retention policy unless a security artifact explicitly uses the 14-day policy above.
