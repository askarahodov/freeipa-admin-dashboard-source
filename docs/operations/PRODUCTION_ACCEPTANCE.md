# Production acceptance release decision policy

Issue #61 uses bounded acceptance stages and separates **execution evidence** from the final **release decision**.

The canonical policy implementation is:

- `scripts/production-acceptance-release-policy.mjs`
- `release/acceptance-waivers.json`

## Outcomes

The release decision has three possible outcomes:

- `passed` — every selected stage and the core safety stages passed;
- `passed_with_exceptions` — all mandatory stages passed, while an explicitly optional external-dependency stage was skipped for an allowed reason or covered by a valid reviewed waiver;
- `failed` — any required evidence is missing, invalid, failed without an allowed waiver, or was skipped when skipping is not allowed.

Core stages `compose_start`, `baseline` and `cleanup` are always required.

## Non-waivable boundaries

The following are intentionally non-waivable:

- compose startup;
- baseline health/readiness and schema checks;
- local authentication/RBAC acceptance;
- P0 operational acceptance;
- settings persistence/rollback;
- backup/restore smoke;
- previous-supported-version upgrade;
- cleanup.

Report redaction is enforced before artifacts are persisted and therefore is not represented as a waiver-capable stage.

An unconfigured previous-supported release source remains release-blocking. #738 must publish a real immutable predecessor; no waiver may convert that condition into a successful skip.

## Optional external dependencies

Only the FreeIPA and XYOps acceptance stages are classified as external-dependency stages. They may be explicitly skipped only with one of these bounded codes:

- `dependency_unconfigured`
- `dependency_unavailable`

A generic `not_requested` or arbitrary operator text is not an allowed release skip.

## Waivers

The checked-in registry is empty by default. A waiver is repository-reviewed configuration and requires:

- unique bounded `id`;
- exact `stageId`;
- `owner`;
- human-readable `reason`;
- issue/ticket `approvalRef`;
- UTC `expiresAt`.

Expired waivers fail closed. Only FreeIPA/XYOps stages accept waivers. There is at most one active registry entry per stage.

The evaluator persists only bounded waiver metadata in its decision evidence; credentials, URLs, cookies and upstream payloads remain prohibited by the existing report redaction gate.

## Current checkpoint

Checkpoint J defines and tests the deterministic policy layer. The next #61 checkpoint composes the final one-command release gate and emits explicit skipped evidence for optional prerequisites before applying this decision policy.
