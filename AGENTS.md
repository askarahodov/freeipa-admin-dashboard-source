# Repository instructions for AI agents

These instructions apply to **every AI agent** working in this repository, regardless of model, tool, role, or entry point. Treat this file as the repository-level operating contract. Read it before starting work.

## Mandatory delivery workflow

Every task must move through the same lifecycle:

**understand -> inspect -> plan -> implement -> focused tests -> review/security -> documentation -> PR/CI -> merge -> post-merge verification -> close/checkpoint**

Do not skip a stage merely because the change looks small. A stage may be explicitly marked not applicable, but the agent must be able to explain why.

### 1. Understand the task

- Read the issue/request and its acceptance criteria.
- Identify dependencies, blockers, related issues, and security/operational constraints.
- Do not silently broaden the task into unrelated cleanup or refactoring.

**Why:** solve the requested problem instead of creating a different one.

### 2. Inspect the current repository state

- Fetch the latest `main` before implementation.
- Inspect the actual implementation, tests, documentation, and configuration involved.
- Check for overlapping open PRs/branches when multiple agents may be active.
- Never assume repository state from an old conversation or stale checkout.

**Why:** avoid duplicate work, conflicts, and changes based on obsolete code.

### 3. Plan the smallest complete change

- Define the intended behavior and risks before editing.
- Prefer the existing architecture and source of truth over parallel mechanisms.
- Keep the diff focused and reviewable.

**Why:** make the change easier to validate, review, rollback, and maintain.

### 4. Implement on a dedicated branch

- Do not make feature/fix changes directly on `main`.
- Use a task-specific branch and PR.
- Preserve existing security boundaries unless the task explicitly changes them.
- Do not hide failures with broad exception handling, disabled checks, or weaker assertions.

**Why:** keep `main` stable and make every meaningful change traceable.

### 5. Run risk-based tests

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

**Green means continue. Red means investigate.** Never merge by ignoring a relevant red test. Determine whether it is a product regression, test defect, or genuine infrastructure failure and record the conclusion.

### 6. Perform review and security review

Before considering implementation complete:

- inspect the final diff, not only individual edited files;
- look for regressions, security boundary violations, data/secret leakage, unsafe defaults, race/concurrency problems, missing error handling, and unnecessary complexity;
- verify that tests prove the behavior rather than only exercising code;
- for security-sensitive changes, explicitly consider abuse and bypass paths.

An agent reviewing its own work must switch perspective and try to break the implementation. If another review agent is available, use it for high-risk changes.

**Why:** passing tests do not prove that the design is safe or complete.

### 7. Keep documentation truthful

Update active documentation, examples, environment variables, runbooks, or architecture contracts whenever operator/developer behavior changes.

Do not document intended behavior that the code does not implement, and do not leave documentation describing behavior that was removed.

**Why:** documentation is part of the product and operations contract.

### 8. Open a PR and let required CI gates run

The PR must explain:

- what problem is being solved;
- what changed;
- important risks/security decisions;
- what was tested;
- rollback or recovery considerations when relevant;
- the issue it closes or relates to.

Do not merge while relevant required checks are still pending or failing.

**Why:** the PR is the auditable checkpoint shared by humans and other agents.

### 9. Merge only when the checkpoint is green

Merge when:

- acceptance criteria are met;
- relevant tests and CI are green;
- review findings are resolved;
- documentation matches behavior;
- no known blocking regression remains.

If these conditions are not met, continue fixing the same task instead of moving on and pretending it is complete.

### 10. Verify after merge

After merge:

- verify the resulting `main`/post-merge checks when available;
- confirm the issue is actually resolved by the merged behavior;
- close/update the issue and record follow-up work separately instead of hiding unfinished scope.

**Why:** a green PR is not the final state; the merged repository is.

### 11. Continue from a clean checkpoint

When the current task is complete and `main` is healthy, select the next task by priority, dependencies, security impact, and how much other work it unblocks.

Do not optimize for the number of closed issues. Optimize for a stable, secure, understandable repository.

## Role expectations

Agents may specialize, but specialization does not remove lifecycle responsibilities:

- **Coordinator / lead agent:** checks dependencies and collisions, maintains scope, decides whether the checkpoint is complete, and continues to the next task only after it is safe.
- **Architecture agent:** validates boundaries, source-of-truth ownership, compatibility, migration/rollback strategy, and avoids parallel architecture.
- **Implementation agent:** makes the smallest complete code change and adds appropriate tests.
- **Test agent:** chooses coverage by risk, tries failure/edge/concurrency paths, and does not demand unrelated E2E suites.
- **Review / security agent:** actively searches for regressions, bypasses, unsafe defaults, secret/data exposure, and incomplete acceptance criteria.
- **Documentation agent:** verifies that active docs/runbooks/config examples describe the merged behavior accurately.

If one AI agent performs several roles, it must still perform the responsibilities of each relevant role rather than collapsing the workflow into “write code and see if CI passes”.

## Stop/continue rules

- **Tests green + review clean + acceptance met:** continue toward merge/checkpoint.
- **Relevant test red:** investigate and fix before proceeding.
- **Review finds a blocker:** fix it and rerun affected checks.
- **Infrastructure failure:** gather evidence, distinguish it from a product failure, and do not weaken tests to make CI green.
- **New unrelated problem discovered:** create/record follow-up work; do not silently expand the current PR unless it blocks correctness or safety.
- **Collision with another active agent/PR:** coordinate or rebase instead of independently implementing the same change.

## Definition of done

A task is not done because code was written. It is done when the requested behavior is implemented, appropriate tests are green, review/security concerns are resolved, documentation is accurate, the change is merged safely, and the resulting repository state is healthy.
