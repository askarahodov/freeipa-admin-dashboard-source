# Risk-based testing policy

This repository uses **risk-based test selection**. A pull request must run the cheapest tests that prove the changed behavior, plus any tests required by the affected runtime boundary. Do not run unrelated browser suites merely because a file lives under `app/`, `tests/`, `scripts/`, `worker/`, or `db/`.

The executable canonical planner is `scripts/auth-e2e-scope.mjs`. The planner owns path classification, package-semantic classification, selected browser categories, contract tests, full-regression fallback reasons, required-job inventory and the human-readable Actions summary. Workflows must consume this plan instead of maintaining an independent copy of the same policy.

## Always-on pull request checks

The normal CI remains the baseline for every code change: install/lockfile validation, lint, build, security checks, unit/contract test shards, and the stable aggregate `Required CI` check. Browser E2E is an additional risk check, not a replacement for build or unit tests. Epic #560 does not weaken these jobs until a later task explicitly changes their execution policy with fail-closed gates.

## Pull-request diff semantics

For pull requests, routing is based on the full PR change from the **merge-base of the current base and head** to the PR head. This avoids treating changes that exist only on an advanced base branch as if the PR introduced them, while still covering all commits in the PR.

The input includes git change status. Additions, modifications and deletions are evaluated. For rename/copy records both the old and new paths are evaluated, so a rename cannot escape the policy by moving a sensitive file to or from a different boundary. If merge-base/diff generation fails or the planner receives invalid diff records, the workflow fails closed instead of reporting an empty successful plan.

## Browser E2E categories

The canonical planner maps changed files to these categories:

- **auth** — login/logout, unauthenticated redirects, invalid credentials, authentication session behavior and the canonical resolved request context. Runs `auth.spec.mjs`.
- **rbac** — local-user administration, role assignment, permission restrictions and request-context permission boundaries. Runs `rbac-user.spec.mjs` and `role-restrictions.spec.mjs`.
- **freeipa** — FreeIPA user/group/membership browser behavior, including runtime query/filter/sort/pagination code under `src/freeipa/**`. Runs `freeipa-crud.spec.mjs`.
- **xyops** — XYOps operation, approval, cancellation and result lifecycle. Runs `xyops-lifecycle.spec.mjs`.
- **settings** — administrative settings session and draft/apply/reset/rollback lifecycle. Runs `admin-session-settings.spec.mjs` and `zz-settings-draft-lifecycle.spec.mjs`.
- **ui** — shared authenticated UI accessibility, keyboard behavior, responsive layout and visible-status quality. Runs `ui-quality.spec.mjs`.

A change may select more than one category. The planner takes the union of affected categories. Top-level feature components under `app/` are owned by both their functional category and `ui` where applicable.

## Contract-test categories

Database/schema changes run the portal schema contract tests. A database-only change does **not** imply settings browser E2E. Settings changes run settings lifecycle/source-safety contracts and browser coverage only when the changed boundary affects settings behavior visible through that suite.

## Full regression

Full browser regression is intentional for changes that can affect the whole E2E runtime, including the root `Dockerfile`, `fixtures/compose/e2e.yaml`, `fixtures/env/e2e.example`, `e2e/Dockerfile`, Playwright configuration, package dependency graph/lockfile, Vite configuration, the E2E runner and the routing policy itself. `main`, scheduled, and manually dispatched runs also use full regression.

An unclassified path under runtime-sensitive roots such as `src/`, `app/`, `worker/`, `fixtures/`, `e2e/` or `scripts/` does not produce an empty success. It forces conservative full coverage until the canonical policy is extended with an explicit ownership rule.

## `package.json` semantic routing

A change to `package.json` is not automatically equivalent to a full browser-runtime change. The planner compares the merge-base and head JSON semantically:

- dependency graph, overrides, engines, package manager, module type and similar runtime fields require full regression;
- build/runtime/E2E runner scripts, and unknown script names, require full regression;
- a change limited to recognized server-test, docs-check, lint, security-inspection or developer-inspection scripts does not by itself require full browser E2E;
- unknown semantic top-level fields are conservative and require full regression;
- if base/head package data cannot be compared, the planner requires full regression.

This distinction only scopes browser coverage. Outside an explicitly approved later policy change, the normal Node/CI suite remains required for code changes.

## Explainable plan

Every Scoped E2E run writes `GITHUB_STEP_SUMMARY` from the same canonical plan used for machine outputs. The summary shows changed inputs, scoped/full mode, full-fallback reason, selected categories/specs/contracts, required jobs and decision reasons. It must not contain secrets or a separately maintained classification table.

The workflow validates that mandatory planner outputs exist. Missing/invalid outputs, planner exceptions, invalid diff records or failed diff preparation fail the stable check rather than being interpreted as an intentional skip.

## Agent workflow

Before changing code, every human or AI agent must:

1. Identify the changed files and the functional/risk boundaries they belong to.
2. Run focused unit/contract tests for the code being changed while developing.
3. Use the repository canonical planner for integration/browser coverage; do not manually add unrelated E2E suites "just in case".
4. If a changed runtime path has no routing rule, extend the canonical planner and its contract tests in the same PR.
5. If a test outside the selected category fails, first verify whether it is actually coupled to the change. Do not weaken or delete valid tests to make an unrelated PR green.
6. For shared infrastructure or cross-cutting runtime changes, deliberately request full regression.

The routing contracts are `tests/auth/auth-e2e-routing.test.mjs` and `tests/architecture/test-scope-routing.test.mjs`.
