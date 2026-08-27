# Repository instructions for AI agents

These instructions apply to every AI agent working in this repository.

## Test selection is mandatory

Read `docs/TESTING_POLICY.md` before changing CI, authentication, authorization, integrations, settings, database/schema code, or browser UI.

For every task:

- inspect the changed files before choosing tests;
- identify the affected functional/risk categories;
- run focused unit and contract tests during implementation;
- let `scripts/auth-e2e-scope.mjs` choose browser E2E categories from the changed files;
- do not run or require unrelated browser categories simply because they exist;
- do not bypass a selected category because it is slow or flaky; fix the relevant failure or document a genuine infrastructure failure;
- when a new runtime area is introduced, add or update a routing rule and its contract test in the same change;
- use full E2E regression only for cross-cutting E2E/runtime infrastructure changes or explicit full-regression runs.

The expected categories are `auth`, `rbac`, `freeipa`, `xyops`, `settings`, and `ui`. Mixed changes use the union of affected categories.

CI routing policy is executable project architecture. Treat changes to the router, workflow, or category ownership as high-conflict changes and keep them small and reviewable.
