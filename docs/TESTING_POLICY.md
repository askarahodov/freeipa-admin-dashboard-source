# Risk-based testing policy

This repository uses **risk-based test selection**. A pull request must run the cheapest tests that prove the changed behavior, plus any tests required by the affected runtime boundary. Do not run unrelated browser suites merely because a file lives under `app/`, `tests/`, `scripts/`, `worker/`, or `db/`.

The executable canonical browser/risk planner is `scripts/auth-e2e-scope.mjs`. `scripts/ci-required-plan.mjs` is the Required CI projection for job execution and reuses the canonical changed-input parser instead of inventing independent diff semantics. `scripts/ci-required-gate.mjs` validates actual job results against that plan. Workflows must consume these executable contracts rather than duplicating allowlists or fail-open result logic in YAML.

## Pull request CI policy

Every pull request still creates the stable `CI / Required CI` aggregate. Code, runtime, policy, executable example/fixture, developer-instruction and mixed changes use the complete current CI path. Browser E2E remains an additional risk check, not a replacement for build or unit tests.

A narrowly defined **ordinary documentation-only** fast path is allowed only when every changed path is user-facing Knowledge Base prose in this positive allowlist:

- `docs/guide/README.md`;
- Markdown below `docs/guide/getting-started/**`, `user/**`, `operator/**`, `administrator/**`, `support/**`, `concepts/**` or `troubleshooting/**`.

The root `README.md`, `docs/README.md`, `docs/guide/developer/**` and `docs/guide/operations/**` are deliberately excluded because current repository content there includes development, deployment, security, testing or operational instructions. Testing/development policy, AI instructions, security/operations reference material, workflow files, executable examples/fixtures and anything outside the allowlist are not classified as ordinary docs-only. A mixed docs + runtime diff is never docs-only.

For an ordinary docs-only pull request, Required CI still runs the canonical planner, deterministic test discovery, documentation consistency and dependency-security policy validation. It may intentionally skip the product build, server-test matrix, runtime-image Docker scan and recovery-container job. None of these skips is accepted merely because GitHub reports `skipped`: the aggregate gate accepts a skip only when the successful canonical CI plan marks that exact job not required.

## Pull-request diff semantics

For pull requests, routing is based on the full PR change from the **merge-base of the current base and head** to the PR head. This avoids treating changes that exist only on an advanced base branch as if the PR introduced them, while still covering all commits in the PR.

The input includes git change status. Additions, modifications and deletions are evaluated. For rename/copy records both the old and new paths are evaluated, so a rename cannot escape the policy by moving a sensitive file to or from a different boundary. Workflows use NUL-delimited `git diff --name-status -z --find-renames` input so unusual pathnames are preserved. If merge-base/diff generation fails, a planner receives invalid input, or a pull-request diff is unexpectedly empty, the stable gate fails closed.

## Required CI gate semantics

`CI / Required CI` verifies the successful planner result, a versioned plan payload and terminal results for every governed job. A job marked required must finish `success`. A job marked not required may finish only `success` or `skipped`; failure/cancellation is never converted into success. Missing plan fields, missing/unknown job results, required `skipped`, required `cancelled`, required `failure`, malformed JSON and planner failure all block the aggregate.

The workflow does not use workflow-level `paths-ignore`, so the stable required status is created for docs-only PRs instead of remaining permanently pending.

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

This distinction scopes browser coverage only. `package.json` is outside the ordinary docs-only allowlist, so Required CI remains complete for any package manifest change.

## Explainable plans

Scoped E2E and Required CI write `GITHUB_STEP_SUMMARY` from their executable plan. The summaries show selected mode, required coverage/jobs and decision reasons without secrets. Missing/invalid outputs or failed diff preparation fail the stable checks rather than being interpreted as intentional skips.

## Agent workflow

Before changing code, every human or AI agent must:

1. Identify the changed files and the functional/risk boundaries they belong to.
2. Run focused unit/contract tests for the code being changed while developing.
3. Use the repository executable planners for CI/browser coverage; do not manually add or remove suites "just in case".
4. If a changed runtime path has no routing rule, extend the canonical browser planner and its contract tests in the same PR.
5. If a test outside the selected category fails, first verify whether it is actually coupled to the change. Do not weaken or delete valid tests to make an unrelated PR green.
6. For shared infrastructure or cross-cutting runtime changes, deliberately request full regression.

Routing/gate contracts are protected by `tests/auth/auth-e2e-routing.test.mjs`, `tests/architecture/test-scope-routing.test.mjs` and `tests/architecture/ci-required-plan.test.mjs`.
