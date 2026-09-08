# AI agent delivery workflow

This is the detailed execution guide for AI agents working in this repository. `AGENTS.md` contains the non-negotiable rules. `docs/TESTING_POLICY.md` owns test selection. The pull-request template owns review evidence fields. Do not duplicate those contracts here when a reference is enough.

## Core lifecycle

Every meaningful task follows:

`understand -> inspect -> coordinate -> design -> implement -> focused tests -> independent review/security -> documentation -> PR/CI -> merge -> post-merge verification -> checkpoint`

The lifecycle is mandatory; **depth is risk-based**. A small docs correction should not receive the ceremony of a security migration, while a high-risk change must not be treated like a typo fix.

## Risk levels

Classify the change before implementation and raise the level whenever uncertainty or impact increases.

### Level 1 — low risk

Examples: wording/docs fixes, comments, narrowly scoped non-runtime metadata, deterministic test maintenance that does not change product behavior.

Expected depth:

- fresh-state and collision check;
- small focused diff;
- relevant static/contract validation;
- final diff review;
- normal PR/CI and post-merge verification.

Architecture/security analysis may be brief when clearly not applicable.

### Level 2 — normal product change

Examples: ordinary UI/backend behavior, integrations, settings, bug fixes, non-sensitive refactoring.

Expected depth:

- acceptance criteria and source-of-truth inspection;
- explicit risk/compatibility review;
- focused regression tests plus routed integration/E2E coverage;
- final independent review;
- documentation/rollback assessment;
- full required CI and post-merge verification.

### Level 3 — high risk

Examples: authentication/RBAC, secrets, security boundaries, schema/data migration, persistence/recovery, CI trust boundaries, deployment/runtime foundations, destructive operations, cross-cutting architecture.

Expected depth additionally includes:

- explicit abuse/failure modeling;
- migration/backward-compatibility and rollback/recovery plan;
- concurrency/idempotency/restart analysis where applicable;
- degraded dependency and fail-open/fail-closed decisions;
- independent review/security perspective when available;
- stronger negative and recovery-path tests.

When uncertain, use the higher level.

## 1. Understand and bound the task

Before editing:

- read the complete issue/request and acceptance criteria;
- identify prerequisites, dependencies, operational constraints, security boundaries and explicit non-goals;
- distinguish requested behavior from optional cleanup;
- state assumptions when repository evidence is incomplete;
- never present an assumption as confirmed fact.

If the requested behavior conflicts with the current architecture, resolve that conflict explicitly instead of silently creating a parallel mechanism.

## 2. Inspect fresh repository state

Work from the current repository, not conversation memory.

Before branching or editing:

- fetch current `main`;
- inspect the actual source-of-truth code, tests, configuration and active documentation;
- check open PRs and active branches for overlapping work;
- identify the owner/coordinator of the workstream;
- verify whether prerequisites are merged, still open, or obsolete.

If `main` changes materially during the task, re-check the affected area before merge.

## 3. Coordinate multi-agent work

Parallel work is useful only when scopes are independent.

- one workstream has one clear owner/coordinator;
- do not independently implement the same change after a collision is detected;
- architecture, implementation, testing, review/security and documentation may be delegated, but responsibilities remain mandatory;
- another agent's conclusion is evidence to verify, not unquestionable truth;
- the review agent inspects the actual final diff;
- the coordinator inspects actual CI/check results before declaring success.

When scopes overlap, split ownership, rebase, sequence the work, or wait for the prerequisite merge instead of racing duplicate implementations into `main`.

## 4. Design the smallest complete change

Prefer existing project architecture and canonical sources of truth.

Determine as applicable:

- which module owns the behavior;
- API/config/schema compatibility;
- migration and rollback behavior;
- security trust boundaries;
- concurrency/idempotency needs;
- restart/crash persistence behavior;
- external dependency timeout/error behavior;
- resource/abuse limits.

Do not introduce a second authentication, authorization, migration, audit, scheduler, persistence, or configuration mechanism when an existing project abstraction owns that responsibility unless the architectural decision is explicit and reviewed.

## 5. Implement safely

- use a dedicated branch and PR for meaningful changes;
- keep the diff focused and reviewable;
- avoid unrelated formatting, renaming, or refactoring;
- never weaken RBAC, origin/CSRF checks, validation, encryption/TLS decisions, approvals, audit, assertions, or tests just to get green CI;
- do not place real secrets, credentials, cookies, tokens, private keys, or sensitive production data in code, fixtures, logs, PR text, or artifacts;
- do not log sensitive request/response fields;
- prefer stable machine-readable error contracts over UI dependence on exception wording;
- validate important failure paths, not only happy paths.

If an unrelated defect is discovered, record follow-up work unless it blocks correctness or safety of the current change.

## 6. Test by risk, not habit

`docs/TESTING_POLICY.md` is authoritative for test selection.

During implementation:

- run the smallest tests that prove the changed behavior;
- add a regression test for a fixed defect when practical;
- include negative/error cases relevant to the risk;
- test concurrency/idempotency where state can be mutated concurrently;
- test restart/persistence where state must survive process restart;
- test compatibility/migration behavior when persisted data or schemas change;
- use browser E2E only for affected categories selected by repository routing policy.

Classify a red test before acting:

1. regression caused by the change;
2. real pre-existing defect exposed by the work;
3. incorrect/outdated test;
4. flaky test;
5. genuine infrastructure failure.

Do not weaken a valid test merely because it is red.

## 7. Independent review and security review

Review the **final combined diff**, not only files while they are being edited.

Look for:

- missing acceptance criteria or hidden scope expansion;
- duplicate sources of truth;
- security bypasses and unsafe defaults;
- fail-open behavior where fail-closed is required;
- secret or personal-data exposure;
- race conditions, lost updates, retry/idempotency bugs;
- partial-write and crash-recovery problems;
- incompatible API/schema/config changes;
- missing rollback path;
- tests that exercise code without proving the intended behavior;
- unnecessary complexity or dead code.

For security-sensitive work, model applicable abuse paths such as forged headers, unauthorized access, enumeration, brute force, replay, malformed input, and degraded dependencies.

## 8. Keep documentation truthful

Documentation is part of Definition of Done when behavior changes for operators, developers, or users.

Update active docs as applicable for:

- environment variables and configuration;
- deployment/startup requirements;
- migrations and rollback;
- API/security/trust contracts;
- recovery/runbooks;
- test/development workflow.

Examples use placeholders, never real credentials. Do not document future behavior as already implemented.

## 9. PR checkpoint

Use the repository pull-request template as the evidence contract. The PR should let another agent or human validate the change without reconstructing the entire conversation.

Evidence must be truthful: list checks actually run, note relevant risks/limitations, identify coordination/source-of-truth decisions, and provide rollback/recovery information when applicable.

Do not merge with relevant checks pending or failing.

## 10. Merge gate

Merge only when all applicable conditions are true:

- acceptance criteria are satisfied;
- relevant focused tests are green;
- required CI is green;
- blocking review/security findings are resolved;
- documentation reflects actual behavior;
- collision/conflict concerns are resolved;
- no known blocking regression remains;
- rollback/recovery is understood for risky changes.

Green CI alone is not permission to merge when review found a blocker.

## 11. Post-merge verification

The merged repository is the final artifact, not the PR branch.

After merge:

- fetch/inspect resulting `main`;
- confirm the expected change is present;
- verify post-merge checks when available;
- confirm the linked issue/request is actually satisfied;
- record residual work separately;
- revert or hotfix a blocking regression instead of declaring a false checkpoint.

Only then is the checkpoint complete.

## 12. Selecting the next task

After a healthy checkpoint, prioritize by:

1. blockers and dependencies;
2. security/correctness severity;
3. user/operational impact;
4. work that unlocks other tasks;
5. project priority labels/milestones;
6. implementation cost after the factors above.

Do not optimize for easiest issue or largest closed-issue count.

## Role responsibilities

### Coordinator

Owns scope, dependencies, collisions, evidence, merge readiness, and checkpoint completion.

### Architecture

Finds canonical ownership, validates boundaries/compatibility, and prevents duplicate architecture.

### Implementation

Produces the smallest complete change, follows project conventions, and adds appropriate regression coverage.

### Test

Maps changes to risk, covers success/failure/edge behavior, and reports evidence rather than only “green/red”.

### Review / Security

Independently challenges the final diff for regressions, bypasses, unsafe defaults, exposure, and incomplete acceptance criteria.

### Documentation

Keeps active docs, runbooks, examples, and contracts aligned with merged behavior.

## Engineering checklist

Consciously decide whether each item is applicable; “not applicable” is valid, silently ignoring a relevant category is not:

- authentication/authorization and privilege boundaries;
- input validation/output encoding;
- secrets/sensitive-data handling;
- concurrency, idempotency, retries;
- persistence, restart, crash recovery;
- schema/data migration and backward compatibility;
- external dependency timeout/error/partial-response behavior;
- fail-open versus fail-closed behavior;
- observability without sensitive-data leakage;
- rollback/operator recovery;
- stable API/error contracts;
- resource/abuse limits;
- deployment/runtime compatibility.

## Evidence language

Distinguish certainty:

- **confirmed by test/CI** — directly executed/observed;
- **confirmed by code/config inspection** — present in current repository state;
- **inferred** — reasonable but not executed/observed;
- **not verified** — evidence unavailable.

Do not report inferred or unverified state as tested.

## Blocked work

When genuinely blocked, leave useful evidence:

- precise root cause/dependency;
- reproducible command/test when possible;
- relevant logs/error codes without secrets;
- minimal next action;
- follow-up issue when appropriate.

Being blocked is not permission to weaken security or merge incomplete behavior.

## Definition of Done

A task is complete only when requested behavior is implemented, relevant tests are green, review/security concerns are resolved, documentation is truthful, the change is safely merged, and resulting `main` is healthy.
