# Autonomous merge gate

The executable owner for Autonomous Development V1 merge authorization is `scripts/autonomous-merge-gate.mjs`.

This contract consumes a valid REVIEW checkpoint from the execution contract and exact-head CI/review evidence. It does **not** perform a merge itself. A caller may invoke GitHub merge only after the gate returns `READY_FOR_MERGE`, and must still pass the exact authorized head SHA to the GitHub merge API.

## Repository protection prerequisite

Issue #391 is a hard technical prerequisite for autonomous merge.

The gate returns `PROTECTION_REQUIRED` unless repository evidence proves that `main` is protected by branch protection or an equivalent ruleset with:

- pull requests required;
- stable required checks `Required CI` and `scoped-e2e`;
- force pushes blocked;
- branch deletion blocked;
- no ordinary bypass.

As of the implementation of #685, GitHub reports this repository's `main` as `protected: false`. Therefore the policy can be implemented and tested, but autonomous merge remains disabled until #391 is actually enforced and read back.

## Exact-head gate

After protection is compatible, merge authorization requires all of the following on the same expected PR head:

- PR is open, non-draft, mergeable and targets `main`;
- PR head equals the expected head;
- current `main`, PR base SHA and the base used by validation still match;
- autonomous task state is `REVIEW`;
- execution contract reports a confirmed PR checkpoint;
- acceptance criteria are explicitly satisfied;
- focused validation is green;
- `CI / Required CI` is terminal success;
- Scoped E2E is terminal success;
- PR Collision Guard is terminal success;
- blocking review/security findings and unresolved threads are zero;
- documentation impact is resolved;
- dependencies/blockers are resolved;
- rollback/recovery evidence is present when the change requires it.

Green CI by itself is never sufficient.

## Decisions

- `READY_FOR_MERGE` — exact-head repository contract is satisfied and protection is enforced;
- `WAIT` — all non-check evidence is valid but at least one required exact-head check is still pending;
- `BLOCKED` — missing, failed, skipped, stale, conflicting or unresolved evidence exists;
- `PROTECTION_REQUIRED` — GitHub repository enforcement is absent or incompatible.

## Stale-base protection

The gate binds validation to both head and base.

If `main` advances after validation, `currentMainSha`, `validatedBaseSha` and the PR base evidence no longer match. The result is `BLOCKED`; the caller must refresh/rebase/update evidence rather than reuse old green checks.

## Merge authorization

A successful result contains a bounded authorization record:

- exact expected head SHA;
- exact validated base SHA;
- force merge forbidden;
- bypass forbidden;
- merge only through the pull request.

No force/bypass path is part of this contract.

## Source of truth

- task/claim/review checkpoint: `AUTONOMOUS_EXECUTION_CONTRACT.md`;
- repair loop: `AUTONOMOUS_CI_REPAIR.md`;
- test selection and stable aggregate CI semantics: `docs/TESTING_POLICY.md` and repository workflows;
- repository enforcement: #391 / actual GitHub branch protection or ruleset;
- post-merge completion and next-task transition: #686.
