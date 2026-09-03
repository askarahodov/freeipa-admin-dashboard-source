# AI agent delivery workflow

This document is the detailed execution contract for AI agents working in this repository. `AGENTS.md` is the mandatory entry point and concise policy; this document explains how to execute that policy consistently in multi-agent and single-agent work.

## Core lifecycle

Every non-trivial task follows the same lifecycle:

`understand -> inspect -> coordinate -> design -> implement -> focused tests -> independent review/security -> documentation -> PR/CI -> merge -> post-merge verification -> checkpoint`

A stage may be marked not applicable only when the reason is clear from the task. Writing code or obtaining one green test is never sufficient by itself.

## 1. Understand and bound the task

Before editing:

- read the complete issue/request and acceptance criteria;
- identify prerequisites, dependent issues, operational constraints, security boundaries, migration concerns and explicit non-goals;
- distinguish the requested behavior from optional cleanup;
- state assumptions when the repository does not provide enough evidence;
- never turn an assumption into a claimed fact.

If acceptance criteria conflict with the current architecture, the architecture conflict must be resolved explicitly instead of silently implementing a parallel mechanism.

## 2. Inspect fresh repository state

Agents must work from the current repository, not conversation memory.

Before creating a branch or editing:

- fetch current `main`;
- inspect the actual source-of-truth files, tests, configuration and active documentation;
- check open PRs and active branches for overlapping work;
- check whether another agent already owns the issue/workstream;
- verify whether prerequisites are already merged, still open, or obsolete.

If `main` changes materially during a long-running task, re-check the affected area before merge.

## 3. Coordinate multi-agent work

Parallel work is encouraged only when scopes are independent.

Rules:

- one task/workstream should have one clear owner/coordinator;
- agents must not independently implement the same change after a collision is detected;
- architecture, implementation, testing, review/security and documentation may be delegated, but responsibilities remain mandatory;
- conclusions from another agent are evidence to verify, not unquestionable truth;
- the review agent must inspect the actual diff;
- the coordinator must inspect actual CI/check results instead of relying only on another agent saying that tests passed.

When scopes overlap, coordinate, rebase, split the work, or wait for the prerequisite merge rather than racing two implementations into `main`.

## 4. Design the smallest complete change

Prefer existing project architecture and canonical sources of truth.

Before implementation determine:

- which module owns the behavior;
- whether a migration/configuration/API contract is affected;
- backward compatibility expectations;
- failure and rollback behavior;
- security trust boundaries;
- concurrency/idempotency requirements;
- restart/crash behavior;
- external dependency failure behavior.

Do not introduce a second authentication, migration, authorization, audit, scheduler, persistence or configuration mechanism when an existing project abstraction owns that responsibility.

## 5. Implement safely

Implementation rules:

- use a dedicated branch and PR for meaningful changes;
- keep the diff focused;
- avoid unrelated formatting, renaming or refactoring;
- never weaken RBAC, origin/CSRF checks, validation, encryption, TLS decisions, approvals, audit or tests merely to get green CI;
- do not place real secrets, credentials, cookies, tokens, private keys or sensitive production data in code, fixtures, logs, PR text or artifacts;
- do not log sensitive request/response fields;
- prefer stable machine-readable error codes over UI dependence on exception text;
- validate failure paths, not only happy paths.

If a separate defect is discovered, record follow-up work unless it blocks correctness or safety of the current change.

## 6. Test by risk, not habit

`docs/TESTING_POLICY.md` is authoritative for test selection.

During implementation:

- run the smallest tests that prove the changed behavior;
- add a regression test for a fixed defect whenever practical;
- include negative/error cases relevant to the risk;
- test concurrency/idempotency where state can be mutated concurrently;
- test restart/persistence where state must survive process restart;
- test compatibility/migration behavior when persisted data or schemas change;
- use browser E2E only for affected browser/runtime categories selected by repository routing policy.

A red test must be classified before action:

1. product regression caused by the change;
2. real pre-existing product defect exposed by the work;
3. incorrect/outdated test;
4. flaky test;
5. genuine infrastructure failure.

Never make a test weaker just because it is red. Fix the implementation, fix a genuinely incorrect test, or document evidence of infrastructure failure.

## 7. Independent review and security review

Before merge, review the final combined diff.

The reviewer must actively look for:

- missing acceptance criteria;
- hidden scope expansion;
- security bypasses and unsafe defaults;
- fail-open behavior where fail-closed is required;
- secret or personal-data exposure;
- race conditions and lost updates;
- retry/idempotency mistakes;
- partial-write and crash-recovery problems;
- incompatible API/schema/config changes;
- missing rollback path;
- tests that exercise code without proving behavior;
- dead code or unnecessary complexity.

For security-sensitive work, explicitly model abuse: forged headers, unauthorized access, enumeration, brute force, replay, malformed input and degraded dependencies as applicable.

An implementation agent reviewing its own change must deliberately switch perspective and try to break it. High-risk changes should use an independent reviewer when available.

## 8. Keep documentation and examples truthful

Documentation is part of Definition of Done.

Update active docs when behavior changes for operators, developers or users, including:

- environment variables;
- deployment/startup requirements;
- migrations and rollback;
- API contracts;
- security/trust models;
- recovery/runbooks;
- test or development workflows.

Examples must use placeholders, never real secrets or internal credentials.

Do not describe future behavior as already implemented.

## 9. PR checkpoint

A PR must contain enough information for another agent or human to validate it without reconstructing the whole conversation.

Include, when relevant:

- problem and intended outcome;
- scope and non-goals;
- architecture/security decisions;
- important compatibility or migration notes;
- exact relevant tests/checks;
- risks and remaining limitations;
- rollback/recovery procedure;
- documentation changes;
- issue linkage.

Do not merge with relevant checks pending or failing.

## 10. Merge gate

A change may merge only when all applicable conditions are true:

- acceptance criteria are satisfied;
- relevant focused tests are green;
- required CI is green;
- review/security findings are resolved;
- documentation reflects actual behavior;
- branch collision/conflict concerns are resolved;
- no known blocking regression remains;
- rollback/recovery is understood for risky changes.

Green CI alone is not permission to merge if review found a blocker.

## 11. Post-merge verification

The merged repository is the final artifact, not the PR branch.

After merge:

- fetch/inspect the resulting `main`;
- verify post-merge checks when available;
- confirm the expected commit/change is present;
- confirm the linked issue is actually satisfied;
- record any residual or newly discovered work as separate follow-up;
- revert or hotfix when a merge introduces a blocking regression.

Only then declare the task checkpoint complete.

## 12. Selecting the next task

After a healthy checkpoint, choose the next task using:

1. blockers and dependencies;
2. security/correctness severity;
3. user/operational impact;
4. work that unlocks other tasks;
5. repository priority labels/milestones;
6. implementation cost only after the factors above.

Do not optimize for easiest issue or highest count of closed issues.

## Role responsibilities

### Coordinator

- checks fresh `main`, issue dependencies and collisions;
- owns scope and Definition of Done;
- verifies actual CI/review evidence;
- prevents premature merge/closure;
- advances to the next task only after a clean checkpoint.

### Architecture

- finds the canonical source of truth;
- checks boundaries and dependencies;
- designs compatibility/migration/rollback strategy;
- prevents duplicate architecture.

### Implementation

- produces the smallest complete change;
- follows existing project conventions;
- adds or updates appropriate regression tests;
- does not hide failures or weaken controls.

### Test

- maps changes to risk categories;
- covers success, failure and edge behavior;
- considers concurrency, persistence and degraded dependencies where relevant;
- reports evidence rather than only “green/red”.

### Review / Security

- independently reviews the final diff;
- challenges assumptions;
- searches for regressions, bypasses, unsafe defaults and data exposure;
- verifies acceptance criteria and rollback risk.

### Documentation

- verifies active docs against actual behavior;
- updates runbooks/config examples/API/security contracts;
- removes stale claims.

## Mandatory engineering considerations

Every agent should consciously ask whether the task is affected by the following. “Not applicable” is acceptable; silently ignoring a relevant category is not.

- authentication/authorization and privilege boundaries;
- input validation and output encoding;
- secrets and sensitive-data handling;
- concurrency, idempotency and retries;
- persistence, restart and crash recovery;
- schema/data migration and backward compatibility;
- external dependency timeout/error/partial-response behavior;
- fail-open versus fail-closed behavior;
- observability without leaking sensitive data;
- rollback and operator recovery;
- stable API/error contracts;
- resource/abuse limits;
- deployment/runtime compatibility.

## Evidence language

Agents must distinguish levels of certainty:

- **confirmed by test/CI** — directly verified;
- **confirmed by code/config inspection** — present in current repository state;
- **inferred** — reasonable conclusion that has not been executed/observed;
- **not verified** — evidence was unavailable.

Do not report an inferred or unverified state as tested.

## Blocked work

When genuinely blocked, leave the repository/team with a useful artifact:

- precise root cause or dependency;
- reproducible failing test/command when possible;
- relevant logs/error codes without secrets;
- minimal proposed next action;
- follow-up issue if appropriate.

“Blocked” is not permission to weaken security or merge incomplete behavior.

## Definition of Done

A task is complete only when the requested behavior is implemented, relevant tests are green, review/security concerns are resolved, documentation is truthful, the change is safely merged, and the resulting `main` state is healthy.
