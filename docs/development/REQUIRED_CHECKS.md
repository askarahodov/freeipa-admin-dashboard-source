# Required GitHub checks

This repository keeps three stable branch-protection contexts for pull requests targeting `main`:

- `CI / Required CI` — aggregate gate over deterministic test discovery/shard validation, documentation consistency, dependency policy, lint/build, runtime-image Trivy scanning, all server-test shards, and recovery-container verification.
- `Scoped E2E / scoped-e2e` — always exists for pull requests. It first validates the canonical routing contracts and planner outputs, then runs selected contract/Chromium coverage or records an intentional no-browser plan.
- `PR Collision Guard / ownership-collision` — read-only ownership gate that compares exact changed paths with other open PRs targeting `main`; exact overlap on canonical/high-conflict ownership surfaces blocks until merge order or ownership is resolved.

Branch protection for `main` should require all three contexts. Dynamic shard job names should not be configured as individual required checks; `CI / Required CI` is the stable aggregate for them.

## Required CI composition

`CI / Required CI` currently waits for these boundaries:

1. `discover-tests` — finds top-level `tests/*.test.mjs` and validates deterministic shard membership;
2. `docs-consistency` — checks active documentation contracts;
3. `dependency-security` — validates dependency security policy and conditionally performs live audit/SBOM work under the current policy;
4. `build` — installs dependencies, validates the production dependency tree, lints and builds the product;
5. `container-security` — builds the final runtime image and scans fixable HIGH/CRITICAL vulnerabilities;
6. `test` — executes every discovered server test exactly once in the normal server-test matrix;
7. `recovery-compose` — verifies recovery contracts, the isolated recovery image and disposable named-volume smoke.

A failure in any required boundary fails the stable aggregate check. Epic #560 may optimize when these jobs run, but only through later fail-closed planner integration; task #562 does not skip existing CI jobs.

## Canonical plan contract

`scripts/auth-e2e-scope.mjs` is the executable canonical plan for risk-based integration/browser routing. `tests/auth/auth-e2e-routing.test.mjs` and `tests/architecture/test-scope-routing.test.mjs` protect the contract.

For pull requests the workflow uses the merge-base of the current base/head and evaluates the complete PR diff with name status and rename detection. Both sides of rename/copy records are classified; deletions are classified by their removed path. Base-only changes are therefore not attributed to a PR.

The planner exposes:

- scoped versus full-regression mode and the full-fallback reason;
- changed inputs and selected categories;
- browser specs and contract tests;
- the current required-job inventory;
- decision reasons rendered to `GITHUB_STEP_SUMMARY` from the same plan.

Planner failure, invalid diff input, missing mandatory outputs or inability to prepare the PR diff blocks the Scoped E2E check. An intentional no-browser result is valid only after a successful canonical plan explicitly selects no browser specs.

## Browser routing examples

| Representative change | Canonical plan |
| --- | --- |
| `src/auth/local-auth.ts` | auth browser coverage |
| `src/auth/portal-request-context.ts` | auth + RBAC browser coverage |
| `src/freeipa/freeipa-user-query.ts` | FreeIPA browser coverage |
| `app/**` known feature/UI component | owning functional category + UI as applicable |
| `db/**` schema change | schema contracts; no unrelated browser category by default |
| `fixtures/compose/e2e.yaml`, `fixtures/env/e2e.example` | full browser regression |
| dependency graph/lockfile, runtime/build package script | full browser regression |
| recognized `package.json` server-test/docs/lint script only | no automatic full browser regression |
| routing policy / E2E workflow / E2E runner | full browser regression |
| documentation-only change | routing contract only; browser skipped by explicit plan |
| unknown runtime-sensitive path | conservative full browser regression |
| push to `main`, manual dispatch, weekly schedule | full browser regression |

## Server test sharding

`scripts/ci-test-shards.mjs` normalizes and sorts discovered test paths, distributes them round-robin into at most eight shards, and fails closed if shard membership contains a missing, duplicate or unexpected test file. Shard-count optimization belongs to #564 and must use measured before/after evidence from `docs/development/CI_BASELINE.md`.

Each shard uploads its own short-lived TAP log. Recovery contracts may also appear in the independent recovery gate because that job proves container/volume behavior in addition to ordinary server-test execution.

## Security artifacts

Dependency/SBOM and runtime-image scan behavior is governed by the active CI workflow and security policy. Sharding/routing optimization must never remove, bypass or downgrade required security coverage. Scheduled dependency/image security work is owned by #566.

## PR ownership collision guard

`scripts/pr-collision-guard.mjs` is the canonical policy/analyzer for the stable `PR Collision Guard / ownership-collision` check. The workflow has only `contents: read` and `pull-requests: read` permissions and evaluates open PRs targeting `main`.

Blocking exact-path overlap on canonical/high-conflict ownership surfaces must be resolved through explicit merge/dependency order, scope narrowing or replay after the owning PR merges. Do not weaken the collision policy merely to make CI green.

## Concurrency

Obsolete pull-request runs may be cancelled when a newer commit is pushed to the same PR. `main`, manual and scheduled runs are not cancelled by newer runs; each retains its own verification evidence.

## Artifacts

Full browser runs keep the existing sanitized Playwright report, test results and Compose log for 14 days. Documentation-only or other intentional no-browser plans do not create those heavy artifacts because Chromium is not executed.
