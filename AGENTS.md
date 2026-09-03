# Repository instructions for AI agents

These instructions apply to **every AI agent** working in this repository, regardless of model, tool, role, or entry point. Read this file before starting work.

`AGENTS.md` defines the non-negotiable repository contract. Detailed execution guidance lives in [`docs/AI_AGENT_WORKFLOW.md`](docs/AI_AGENT_WORKFLOW.md). Test selection is governed by [`docs/TESTING_POLICY.md`](docs/TESTING_POLICY.md). The pull-request template defines the evidence expected at review time.

## Non-negotiable rules

- Work from the current `main`; do not rely on stale conversation or checkout state.
- Check active PRs/branches before starting overlapping work.
- Keep one clear owner/coordinator per workstream.
- Prefer the existing source of truth; do not create parallel authentication, authorization, persistence, migration, audit, configuration, or scheduling mechanisms without an explicit architectural reason.
- Make meaningful changes on a dedicated branch and PR, not directly on `main`.
- Keep the diff focused; unrelated cleanup belongs in separate work unless it blocks correctness or safety.
- Never weaken security controls, validation, tests, approvals, or assertions merely to obtain green CI.
- Never place real secrets, credentials, tokens, cookies, private keys, or sensitive production data in code, fixtures, logs, PR text, or artifacts.
- Run tests by risk according to `docs/TESTING_POLICY.md`; relevant red tests must be investigated, not bypassed.
- Review the final combined diff before merge. Security-sensitive work must consider abuse and bypass paths.
- Keep active documentation truthful when behavior, configuration, operations, recovery, or developer workflow changes.
- Do not merge with relevant required checks pending or failing, unresolved blocking review findings, or unmet acceptance criteria.
- Verify the resulting `main` and post-merge checks when available before declaring the checkpoint complete.

## Minimum lifecycle

Every meaningful task follows this lifecycle:

**understand -> inspect -> coordinate -> design -> implement -> focused tests -> review/security -> documentation -> PR/CI -> merge -> post-merge verification -> checkpoint**

The depth of each stage is proportional to risk. A documentation typo and an authentication migration do not require the same amount of analysis, but neither may skip applicable safety gates. See `docs/AI_AGENT_WORKFLOW.md` for the risk levels and execution details.

## Roles

Agents may specialize as Coordinator, Architecture, Implementation, Test, Review/Security, or Documentation. Specialization does not remove lifecycle responsibilities. If one agent performs several roles, it must still perform the relevant responsibilities rather than collapsing the task into “write code and see if CI passes”.

## Stop / continue rules

- **Tests green + review clean + acceptance met:** continue toward merge/checkpoint.
- **Relevant test red:** investigate and fix or classify the failure before proceeding.
- **Review finds a blocker:** fix it and rerun affected checks.
- **Infrastructure failure:** collect evidence; do not weaken product tests to make CI green.
- **Collision with active work:** coordinate, split, rebase, or wait for the owning change instead of racing a duplicate implementation.
- **Unrelated defect discovered:** record follow-up work unless it blocks correctness or safety of the current task.

## Definition of done

A task is complete only when the requested behavior is implemented, relevant tests are green, review/security concerns are resolved, documentation is accurate, the change is safely merged, and the resulting `main` state is healthy.
