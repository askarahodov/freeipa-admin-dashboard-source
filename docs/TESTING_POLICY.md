# Risk-based testing policy

This repository uses **risk-based test selection**. A pull request must run the cheapest tests that prove the changed behavior, plus any tests required by the affected runtime boundary. Do not run unrelated browser suites merely because a file lives under `app/`, `tests/`, `scripts/`, `worker/`, or `db/`.

## Always-on pull request checks

The normal CI remains the baseline for every code change: install/lockfile validation, lint, build, security checks, unit/contract test shards, and the stable aggregate `Required CI` check. Browser E2E is an additional risk check, not a replacement for build or unit tests.

## Browser E2E categories

The scoped E2E router maps changed files to these categories:

- **auth** — login/logout, unauthenticated redirects, invalid credentials and authentication session behavior. Runs `auth.spec.mjs`.
- **rbac** — local-user administration, role assignment and effective permission restrictions. Runs `rbac-user.spec.mjs` and `role-restrictions.spec.mjs`.
- **freeipa** — FreeIPA user/group/membership browser CRUD. Runs `freeipa-crud.spec.mjs`.
- **xyops** — XYOps operation, approval, cancellation and result lifecycle. Runs `xyops-lifecycle.spec.mjs`.
- **settings** — administrative settings session and draft/apply/reset/rollback lifecycle. Runs `admin-session-settings.spec.mjs` and `zz-settings-draft-lifecycle.spec.mjs`.
- **ui** — shared authenticated UI accessibility, keyboard behavior, responsive layout and visible-status quality. Runs `ui-quality.spec.mjs`.

A change may select more than one category. The router takes the union of the affected categories; it must not expand to unrelated categories.

## Contract-test categories

Database/schema changes run the portal schema contract tests. Settings changes run settings lifecycle/source-safety contracts. A browser suite is selected only when the changed boundary also has browser behavior to prove.

## Full regression

Full browser regression is intentional and limited to changes that can affect the whole E2E runtime (for example `compose.e2e.yaml`, `e2e/Dockerfile`, Playwright configuration, package dependency graph, Vite configuration, the routing policy itself), and to `main`, scheduled, and manually dispatched runs.

## Agent workflow

Before changing code, every human or AI agent must:

1. Identify the changed files and the functional/risk boundaries they belong to.
2. Run focused unit/contract tests for the code being changed while developing.
3. Use the repository router for integration/browser coverage; do not manually add unrelated E2E suites "just in case".
4. If a changed path has no routing rule but clearly changes runtime behavior, extend the router and its contract tests in the same PR.
5. If a test outside the selected category fails, first verify whether it is actually coupled to the change. Do not weaken or delete valid tests to make an unrelated PR green.
6. For shared infrastructure or cross-cutting runtime changes, deliberately request full regression.

The executable source of truth is `scripts/auth-e2e-scope.mjs`; `tests/auth-e2e-routing.test.mjs` and `tests/test-scope-routing.test.mjs` protect this policy against accidental broadening or gaps.
