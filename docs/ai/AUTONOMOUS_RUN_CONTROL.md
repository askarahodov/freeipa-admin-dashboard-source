# Autonomous run audit and operator controls

The executable owner for Autonomous Development V1 audit/operator safety is `scripts/autonomous-run-control.mjs`.

This layer does **not** replace task selection, claim/PR execution, CI repair, merge gating or post-merge verification. It records their decisions and controls whether orchestration may mutate GitHub state.

## Run identity and audit events

Every bounded autonomous run has a caller-provided machine-readable `runId`.

Each transition/decision produces a monotonic event with:

- contract version;
- run ID and sequence;
- event type;
- Issue number;
- base/head SHA when available;
- transition and reason;
- check/evidence summary;
- retry count;
- gate result;
- exact next action.

Supported event types are `SELECT`, `CLAIM`, `TRANSITION`, `VALIDATION`, `CI_REPAIR`, `MERGE_GATE`, `POST_MERGE`, and `STOP`.

Events can be rendered into a single-line GitHub-visible marker:

```text
<!-- ai-run-event:v1 {...} -->
```

The marker is a repository/GitHub-owned audit representation, not a second task database.

## Secret redaction

Audit serialization recursively redacts fields whose keys represent authorization, API keys, cookies, credentials, passwords, private keys, secrets, sessions or tokens.

It also redacts common bearer/GitHub-token/JWT/private-key value patterns and truncates oversized strings/collections.

Raw workflow logs or sensitive payloads must not be copied into audit events. Marker formatting sanitizes the event again so a caller cannot bypass redaction by constructing an event object manually, and JSON-escapes any `-->` sequence inside the payload so external text cannot terminate the GitHub HTML comment early. CI repair continues to own hashed/sanitized failure fingerprints.

## Operator controls

Before a mutating orchestration action, evaluate:

- the action against the canonical allowlist: `START_TASK`, `TRANSITION`, `REPAIR`, `MERGE`, `CLOSE_ISSUE`, `CONTINUE`;
- `enabled`;
- `paused`;
- `dryRun`;
- max tasks per run;
- max repairs per run;
- max continuous iterations per run;
- current run counters.

Results:

- `ALLOW` — mutation may proceed;
- `DRY_RUN` — report the intended action but `mutationAllowed: false`;
- `STOP` — disabled, paused, limit reached, invalid counters or invalid config.

Pause/disable affect future transitions; they do not rewrite historical audit evidence.

## Dry-run guarantee

Dry-run never creates or mutates Issue, branch or PR state.

The planning layer may still read fresh GitHub state and call deterministic policy functions, but the returned control decision explicitly forbids mutation.

A caller must check `mutationAllowed === true` immediately before any mutating GitHub action.

## Bounded runs

Default operator limits are:

- 5 tasks;
- 3 repairs;
- 5 continuous iterations.

Limits are explicit per bounded run and can be configured to other positive integers. Reaching a limit returns a STOP action instead of self-triggering forever.

## Interrupted-run recovery

Recovery consumes the **canonical execution contract decision** from `scripts/autonomous-execution-contract.mjs`.

It never creates its own branch ownership rules.

- `RECOVER_CLAIM`, `RESUME_IMPLEMENTATION`, `RESUME_PR_CHECKPOINT`, `RESUME_REVIEW` -> resume the existing deterministic claim;
- canonical `BLOCKED` -> surface the same blocker and require fresh reconciliation;
- `CLAIM_NEW` is allowed only for a run with no prior audit event;
- if audit history exists but canonical execution says `CLAIM_NEW`, stop and refresh instead of creating duplicate ownership.

Audit sequence must be monotonic and belong to the same run ID.

## Operator-visible blockers

STOP results always carry a machine-readable reason and concrete `nextAction`, for example:

- `OPERATOR_RESUME_REQUIRED`;
- `FIX_OPERATOR_LIMITS`;
- `RECONCILE_RUN_COUNTERS`;
- `RESOLVE_BLOCKER_AND_REFRESH`;
- `START_NEW_BOUNDED_RUN`.

This allows a human or higher-level coordinator to act without reconstructing hidden conversation state.

## Source of truth

- scheduler/task state: autonomous task state + selector contracts;
- ownership/recovery: autonomous execution contract;
- CI repair: autonomous CI repair contract;
- merge authorization: autonomous merge gate;
- resulting-main/continuation: autonomous post-merge contract;
- audit/operator controls: this document and `scripts/autonomous-run-control.mjs`.
