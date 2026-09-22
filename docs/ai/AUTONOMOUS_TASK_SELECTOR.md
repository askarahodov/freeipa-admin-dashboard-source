# Autonomous task selector

The executable selector for Autonomous Development V1 lives in `scripts/autonomous-task-selector.mjs`.

It consumes a **fresh GitHub snapshot** prepared by orchestration and returns a deterministic decision. It does not read conversation history and does not maintain a second backlog.

## Snapshot boundary

Required inputs:

- `mainSha` — current verified `main` SHA;
- `githubAvailable: true`;
- `issues` — fresh GitHub Issue payloads;
- `openPullRequests` — fresh open PR snapshot;
- `collisionEvidence` — repository-owned ownership/collision result per candidate Issue.

Task state parsing is delegated to `scripts/autonomous-task-state.mjs`. Collision calculation remains owned by repository collision/ownership automation; the selector does not invent a second path-overlap algorithm.

## Fail-closed rules

A READY issue is rejected when:

- dependency evidence is missing or dependency is not DONE;
- task metadata/state is invalid;
- human approval is required;
- collision evidence is missing, unknown or reports a collision;
- required GitHub snapshot data is unavailable.

Only `collisionEvidence[issue] == "clean"` is executable.

## Ordering

Among executable READY candidates the selector uses metadata priority `P0 -> P1 -> P2 -> P3`, then Issue number as a deterministic tie-breaker.

Dependency and eligibility checks happen before priority ordering. This prevents throughput/easiness from bypassing blockers or safety evidence.

## Decisions

- `SELECTED` — one executable issue was selected;
- `NO_WORK` — there is no managed READY work;
- `BLOCKED` — managed work exists or required evidence is unavailable, but safe selection cannot proceed.

Every normal result includes the current `mainSha` and selector contract version as evidence.

This slice only selects work. Claim/mutation concurrency and Issue -> branch -> PR execution belong to #683.
