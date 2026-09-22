# Autonomous task selector

The executable selector for Autonomous Development V1 lives in `scripts/autonomous-task-selector.mjs`.

It consumes a **fresh GitHub snapshot** prepared by orchestration and returns a deterministic decision. It does not read conversation history and does not maintain a second backlog.

## Snapshot boundary

Required inputs:

- `mainSha` — current verified `main` SHA;
- `githubAvailable: true`;
- `issues` — fresh GitHub Issue payloads;
- `openPullRequests` — fresh open PR snapshot;
- `collisionEvidence` — repository-owned ownership/collision result per candidate Issue;
- `rankingEvidence` — normalized per-Issue ranking evidence for the higher-order criteria owned by `docs/ai/AI_AGENT_WORKFLOW.md`.

Task state parsing is delegated to `scripts/autonomous-task-state.mjs`. Collision calculation remains owned by repository collision/ownership automation; the selector does not invent a second path-overlap algorithm.

## Fail-closed rules

A READY issue is rejected when:

- dependency evidence is missing or dependency is not DONE;
- task metadata/state is invalid;
- human approval is required;
- collision evidence is missing, unknown or reports a collision;
- ranking evidence is missing or malformed;
- required GitHub snapshot data is unavailable.

Only `collisionEvidence[issue] == "clean"` is executable.

## Ordering

Eligibility first enforces blockers/dependencies, state, approval and collision safety.

Executable READY candidates are then compared in the canonical order from `AI_AGENT_WORKFLOW.md`:

1. security/correctness severity;
2. user/operational impact;
3. unlock value;
4. project priority `P0 -> P1 -> P2 -> P3`;
5. implementation cost;
6. Issue number only as a deterministic final tie-breaker.

For the normalized ranking fields `securityCorrectness`, `userOperationalImpact`, `unlockValue` and `implementationCost`, integer rank `0` means higher scheduling precedence than `1`, through `3`. The orchestration boundary must provide all four fields for every READY candidate; missing evidence fails closed instead of silently falling back to Issue number or project priority.

The selector therefore does not choose an easier or nominally higher-project-priority task ahead of stronger security/correctness, impact or unlock evidence.

## Decisions

- `SELECTED` — one executable issue was selected;
- `NO_WORK` — there is no valid managed READY work;
- `BLOCKED` — READY/ambiguous managed work exists or required evidence is unavailable, but safe selection cannot proceed.

Valid managed `IN_PROGRESS`, `REVIEW`, `BLOCKED`, `DONE` and `CANCELLED` records are lifecycle/history state; their mere presence does not turn `NO_WORK` into `BLOCKED`.

Every normal result includes the current `mainSha` and selector contract version as evidence.

This slice only selects work. Claim/mutation concurrency and Issue -> branch -> PR execution belong to #683.
