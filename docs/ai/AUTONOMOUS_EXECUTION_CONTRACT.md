# Autonomous execution contract

This contract owns the Autonomous Development V1 step from a selected READY Issue to a valid PR review checkpoint. The executable owner is `scripts/autonomous-execution-contract.mjs`.

It consumes the selector from #682 and does **not** own merge, CI repair, or production deployment.

## Claim protocol

The claim lock is a deterministic Git branch:

```text
agent/task-<issue-number>
```

For example, Issue #683 owns `agent/task-683`.

The orchestration order is intentionally branch-first:

1. refresh current `main`, Issue, branches and open PRs;
2. for a new READY claim, require an exact selector decision whose evidence `mainSha` matches current `main`;
3. re-check collision/ownership evidence immediately before claim/resume;
4. attempt to create `refs/heads/agent/task-<issue>` at that exact `main` SHA;
5. re-fetch branch + Issue;
6. record minimal GitHub-visible claim evidence containing Issue, branch and claim-base SHA;
7. project the managed Issue state from `READY` to `IN_PROGRESS`.

Git ref creation is the duplicate-work lock. GitHub cannot create the same ref twice. A competing or retried coordinator must never invent `agent/task-683-2` or another alternate claim branch.

If the deterministic branch already exists, orchestration does not start a second implementation. It re-fetches state and returns a recovery/resume decision.

If a branch exists while the Issue is still READY, recovery is allowed only while the branch tip still equals the selected current `main`: by contract implementation has not started before the state transition. A diverged READY claim branch is inconsistent and fails closed.

## Claim-base evidence

Once a new branch is verified, orchestration records minimal GitHub-visible claim evidence before moving the Issue to IN_PROGRESS:

```text
issue
branch
baseSha
contractVersion
```

The exact audit/storage presentation can evolve under #687, but execution retries must be able to recover this base SHA from GitHub-owned state. They must not relabel the **current** main SHA as the historical claim base after `main` advanced.

This makes interruption recoverable:

- branch created, state still READY -> reconstruct claim evidence only when branch tip still equals selected main;
- IN_PROGRESS/REVIEW -> require persisted claim-base evidence;
- missing/invalid claim-base evidence -> BLOCKED, not guessed.

## Fresh-state guarantees

A new claim is allowed only when:

- GitHub state is available;
- selector decision is `SELECTED` for the same Issue;
- selector evidence `mainSha` equals the fresh current `main`;
- Issue still validates as managed `READY`;
- human approval is not required;
- fresh collision evidence is `clean`;
- the deterministic claim branch does not yet exist.

After a successful claim, retries in IN_PROGRESS/REVIEW do **not** require the old selector decision; they use the deterministic claim branch + persisted claim evidence. They still require fresh collision evidence before implementation/PR progression.

After claim, `main` may advance while implementation is in progress. That does not authorize direct writes or force-pushes to `main`; stale-head/base handling belongs to later merge-gate work.

## Recovery decisions

The executable contract distinguishes:

- `CLAIM_NEW` — create the deterministic branch first, record claim evidence, then transition to `IN_PROGRESS`;
- `RECOVER_CLAIM` — unchanged claim branch exists while Issue is still READY; reconcile interrupted claim;
- `RESUME_IMPLEMENTATION` — Issue is IN_PROGRESS and branch + claim-base evidence exist without an open PR;
- `RESUME_PR_CHECKPOINT` — IN_PROGRESS + branch + claim-base evidence + open PR;
- `RESUME_REVIEW` — REVIEW + branch + claim-base evidence + open PR;
- `BLOCKED` — evidence/state is inconsistent or unsafe.

Retries therefore converge on the same branch/PR instead of creating parallel ownership.

## Execution context

The agent context contains:

- full owning Issue title/body/number;
- historical claim-base `main` SHA;
- deterministic branch;
- mandatory policy owners:
  - `AGENTS.md`;
  - `docs/ai/AI_AGENT_WORKFLOW.md`;
  - `docs/TESTING_POLICY.md`;
  - `.github/pull_request_template.md`;
  - autonomous state/selector contracts.

The contract explicitly forbids meaningful direct writes to `main`.

Before implementation the coordinator must re-check active ownership. During implementation the agent follows risk-based focused validation from `TESTING_POLICY.md`, not a new orchestration-specific test allowlist.

## PR checkpoint

Opening a PR does not automatically mean the task is ready for REVIEW.

`IN_PROGRESS -> REVIEW` is permitted only when all evidence is present:

- canonical claim branch is used;
- open PR targets `main` from that claim branch;
- PR exact head SHA equals the current claim branch SHA;
- collision re-check is clean;
- at least one applicable focused validation command is recorded and successful;
- final combined diff review is complete with zero blocking findings;
- documentation impact is explicitly decided;
- acceptance criteria review is complete;
- source-of-truth review is complete;
- PR template evidence records validation, security/operational impact, documentation impact, coordination, source-of-truth review, rollback/recovery and claim-base evidence.

If a docs update is not required, a reason is mandatory.

A retried valid REVIEW checkpoint returns `REVIEW_CONFIRMED` rather than applying a second transition.

## Failure / stop behavior

External permission/API failures, collision, human approval, inconsistent Issue/branch/PR state, missing claim-base/local evidence, stale PR head or red validation must stop the transition. They are not reasons to bypass tests or fabricate REVIEW state.

CI failure repair belongs to #684. Merge readiness belongs to #685. Post-merge completion and next-task transition belong to #686.
