# Autonomous post-merge verification and continuation

The executable owner for Autonomous Development V1 post-merge completion is `scripts/autonomous-post-merge.mjs`.

This contract closes the gap between a successful PR merge and a healthy project checkpoint. **Merge is not DONE.**

## Stage 1 — verify resulting main

After a merge, orchestration must refresh GitHub and verify the resulting `main`.

A task can transition from `REVIEW` to `DONE` only when:

- the linked PR is confirmed merged;
- the observed merge commit SHA equals current `main`;
- the expected merged change is explicitly verified present on that same `main`;
- the managed Issue is still valid `REVIEW`;
- `CI / Required CI` is terminal success on resulting `main`;
- Scoped E2E is terminal success on resulting `main`;
- acceptance criteria are re-checked and satisfied on resulting `main`.

Pending checks return `WAIT`.

A failed post-merge check returns `REGRESSION_BLOCKED` with next action `BOUNDED_HOTFIX_OR_REVERT`. The Issue remains open; ordinary next-task selection is forbidden.

Only `VERIFIED_CHECKPOINT` authorizes closing the Issue as completed.

## Stage 2 — close, refresh, select

After the Issue is actually closed, orchestration must refresh GitHub state **from scratch**.

The continuation snapshot must:

- be marked `refreshPhase: after_issue_close`;
- reference the verified resulting `main` SHA;
- contain the just-completed Issue and show it as managed `DONE`;
- contain fresh open PRs, Issues, collision evidence and ranking evidence.

Only then is the canonical selector from `scripts/autonomous-task-selector.mjs` invoked.

This prevents cached pre-merge/pre-close backlog state from unlocking dependent work incorrectly.

## Continuation decisions

- selector `SELECTED` -> `CONTINUE` with the selected Issue;
- selector `NO_WORK` -> `STOP` cleanly;
- selector `BLOCKED` -> `STOP` and surface the blocker/human-action boundary.

Human-approval tasks therefore remain stop conditions because the selector already fails closed on them.

## Bounded continuous execution

Continuous mode carries an explicit iteration counter and maximum iteration limit.

Default V1 limit is 5 completed task transitions per bounded run. Reaching the limit returns `STOP`; a new bounded run may be started deliberately after refreshing state.

There is no unbounded self-trigger loop.

## Regression behavior

Post-merge red is not treated as an ordinary repair of the next task.

The current checkpoint remains unhealthy and the action is a bounded hotfix/revert path. Normal backlog progression resumes only after resulting `main` is healthy and the current Issue can legitimately become DONE.

## Source of truth

- task lifecycle/state: `AUTONOMOUS_TASK_STATE.md`;
- next-task selection: `AUTONOMOUS_TASK_SELECTOR.md`;
- execution/PR checkpoint: `AUTONOMOUS_EXECUTION_CONTRACT.md`;
- CI repair before merge: `AUTONOMOUS_CI_REPAIR.md`;
- merge authorization: `AUTONOMOUS_MERGE_GATE.md`;
- post-merge verification/continuation: this document;
- audit/dry-run/operator controls: #687.
