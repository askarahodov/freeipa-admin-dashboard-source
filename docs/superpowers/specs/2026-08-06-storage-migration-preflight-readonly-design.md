# Read-only storage migration preflight design

Date: 2026-08-06  
Issue: #44  
Branch: `agent/storage-migration-preflight-readonly`

## Summary

Add an explicit admin-only, read-only migration preflight that answers whether the currently pending canonical portal migrations are safe to proceed to a future controlled-apply step. The preflight must not create schema infrastructure, acquire or delete a migration lock, apply SQL, repair drift, or modify backup/audit records except for the existing best-effort audit event describing that the preflight was requested.

This is the third isolated checkpoint for #44 after read-only storage status (#78) and read-only integrity diagnostics (#79).

## Problem

The current startup path calls `ensurePortalSchema`, which may create migration infrastructure, remove a stale lock, acquire a lock, and apply pending migrations. It cannot be reused as a harmless administrative preview.

The existing storage integrity check also compares indexes against the latest canonical schema. That is correct for a fully migrated runtime, but it would incorrectly mark an intentionally older supported schema as degraded when a new migration is pending.

A future migration apply endpoint therefore needs a separate preflight contract that:

- validates the journal and the structure that belongs to the currently applied migration prefix;
- detects a partially applied future migration;
- performs a sanitized database quick check;
- verifies a recent full encrypted backup for the current schema version;
- reports whether the shared migration lock is free, actively held, or stale;
- returns only fixed safe codes and bounded metadata;
- is advisory and cannot itself authorize or execute a migration.

## Goals

1. Provide a stable versioned API for migration readiness.
2. Deny by default when any required check is unknown, unavailable, incompatible, or actively locked.
3. Preserve the current startup migration behavior while centralizing lock semantics in a reusable internal module.
4. Ensure the future controlled-apply path can reuse the same journal, snapshot, backup, quick-check, and lock decisions.
5. Support diagnosis when the browser UI is unavailable through a strict HTTP CLI.

## Non-goals

- applying migrations;
- acquiring, renewing, deleting, or releasing a lock from the public preflight endpoint;
- returning or accepting migration SQL, migration names, checksums, object names, lock owners, database paths, backup payloads, credentials, or raw errors;
- selecting an arbitrary migration or target version;
- destructive migration approval;
- rollback or restore execution;
- readiness/liveness or Docker HEALTHCHECK changes;
- Storage Center UI;
- physical free-disk-space validation, which D1 does not expose through the current runtime contract. Logical database size remains available through storage status. Provider quota failures belong to the future controlled-apply failure contract.

## Considered approaches

### A. Dedicated read-only preflight using the canonical registry — selected

Add a dedicated endpoint and internal evaluator. Validate the applied journal prefix, inspect the cumulative snapshot for the applied prefix, detect future objects without journal entries, check backup/integrity/lock state, and return a fixed decision.

Advantages:

- no storage mutation;
- correct behavior for supported historical versions with pending migrations;
- directly reusable by future controlled apply;
- safe recovery diagnostics when normal schema gates are closed.

Cost:

- requires a new applied-prefix snapshot inspector instead of reusing latest-schema integrity unchanged.

### B. Reuse `ensurePortalSchema` in a dry-run mode — rejected

This would put read-only and mutating behavior behind one complex function. A future regression could accidentally execute infrastructure or migration statements during preflight. The current function also owns retry, stale-lock cleanup, acquisition, renewal, application, and release, so a dry-run flag would create many unsafe branches.

### C. Acquire a lease during preflight — rejected

A preflight HTTP request is short-lived and advisory. Holding a lock after the request would create stale leases, require a secret lease token, and still not eliminate the time-of-check/time-of-use gap. Future apply must rerun the checks and acquire the lock atomically immediately before mutation.

## Public API

### Route

`POST /api/admin/storage/migrations/preflight`

The route is exact; subpaths are not accepted.

### Request

- method must be `POST`;
- body must be an empty JSON object `{}`;
- maximum encoded request size: 1 KiB;
- unknown fields, arrays, null, malformed JSON, and non-empty objects are rejected;
- no target version, migration identifier, SQL, override, force, backup bypass, lock option, or TTL is accepted.

The strict empty request prevents this checkpoint from becoming an arbitrary migration-selection interface.

### Authorization

- local mode: the existing authenticated session resolver must run first;
- local admin requests require the existing same-origin mutation boundary;
- non-local service administration requires the existing constant-time `ADMIN_TOKEN` check on the exact route;
- viewer, operator, anonymous, and invalid service-token requests are rejected before any D1 query;
- the route is allowlisted through schema-failure and maintenance recovery gates, but those gates never bypass authorization.

### Response contract

Contract version: `1`.

```json
{
  "contractVersion": "1",
  "generatedAt": 1786000000000,
  "durationMs": 35,
  "state": "ready",
  "decision": "allow",
  "code": "migration_preflight_ready",
  "pendingMigrationCount": 1,
  "schema": {
    "state": "ready",
    "currentVersion": 3,
    "latestVersion": 4,
    "code": "migration_schema_ready"
  },
  "journal": {
    "state": "valid",
    "appliedCount": 3,
    "pendingCount": 1,
    "code": "migration_journal_valid"
  },
  "integrity": {
    "state": "healthy",
    "code": "migration_quick_check_ok"
  },
  "backup": {
    "state": "ready",
    "ageMs": 1800000,
    "maxAgeMs": 86400000,
    "code": "migration_backup_ready"
  },
  "lock": {
    "state": "available",
    "blocking": false,
    "ageMs": null,
    "ttlMs": 60000,
    "code": "migration_lock_available"
  },
  "correlationId": "cor_example123"
}
```

### Top-level states

- `ready`: pending migrations exist and every required check permits a future apply;
- `not_required`: the database is valid and there are no pending migrations;
- `blocked`: at least one deterministic safety check denies apply;
- `unavailable`: the evaluator cannot establish a trustworthy decision.

### Decisions

- `allow` only when state is `ready`;
- `deny` for `not_required`, `blocked`, and `unavailable`.

`allow` is advisory. It is not an authorization token, lock lease, or guarantee that a later apply will succeed. Future controlled apply must rerun all checks under the migration lock.

### No-pending behavior

After a valid journal and applied-prefix schema inspection finds zero pending migrations, the evaluator returns `not_required` without executing quick check, backup lookup, or lock lookup. Their fixed response states are:

- integrity: `not_required` / `migration_quick_check_not_required`;
- backup: `not_required` / `migration_backup_not_required`, with `ageMs: null` and the fixed maximum age;
- lock: `not_required` / `migration_lock_not_required`, with `blocking: false`, `ageMs: null`, and the shared TTL.

This keeps the response shape exact while avoiding unnecessary database work when there is nothing to apply.

## Schema and journal preflight

### Registry source

Use the same compile-time canonical migration registry currently used by the hardened startup migration path. The endpoint never loads a registry, filename, version, or statement from request data.

### Journal validation

Read the bounded canonical migration journal and validate:

- versions are a contiguous prefix of the registry;
- no future or unknown version exists;
- names and checksums match the compile-time registry;
- duplicate or malformed rows fail closed;
- applied and pending counts are bounded by the registry length.

Only counts, current/latest versions, and fixed codes are returned. Migration names and checksum values remain internal.

### Applied-prefix structure

Build a cumulative snapshot from only the applied migration prefix:

1. start with the baseline snapshot;
2. merge each applied migration snapshot in version order;
3. replace an object definition by canonical name if a later migration intentionally changes it;
4. validate tables, columns, constraints, indexes, and triggers against that cumulative snapshot;
5. classify unexpected non-canonical additions with the existing compatible/incompatible rules.

This prevents missing objects from pending migrations from being misclassified as corruption.

### Partial future migration detection

Build a set of objects owned by pending migration snapshots. If a pending table, index, or trigger already exists without the corresponding journal entry, return a fixed `migration_schema_partial_apply` block. Raw object names and definitions are not returned.

A future migration that cannot provide a deterministic snapshot is not eligible for controlled apply and blocks with `migration_registry_snapshot_required`.

## Database integrity check

Extract the existing sanitized `PRAGMA quick_check(1)` behavior into a shared internal primitive used by both storage integrity and migration preflight.

Preflight accepts only `healthy` / `migration_quick_check_ok`.

- corrupt or non-`ok` result: block;
- unsupported pragma: block;
- query failure: unavailable;
- raw quick-check output is discarded and never returned, audited, or printed by the CLI.

The latest-schema index inventory from the integrity endpoint is deliberately not reused because pending canonical indexes are expected to be absent before apply. Applied-prefix structural validation owns index compatibility for preflight.

## Backup requirement

A backup is required only when one or more migrations are pending.

A qualifying recovery point must be:

- audit action exactly `backup.encrypted.export.completed`;
- outcome `success`;
- resource type `portal-backup`;
- encrypted full backup covering every domain in `PORTAL_BACKUP_DOMAINS` exactly once;
- audit `schema_version` equal to the current applied schema version;
- created no more than 24 hours before preflight.

The query is fixed, ordered newest first, and bounded to at most 20 successful encrypted exports so a recent partial export cannot hide an older qualifying full export.

Backup states:

- `ready`;
- `missing`;
- `stale`;
- `incompatible`;
- `unavailable`;
- `not_required` when no migrations are pending.

Public output contains only state, bounded age, fixed maximum age, and code. Domains, record counts, bytes, paths, manifests, actors, and raw audit metadata are not returned.

An audit event proves that export generation completed; it cannot prove that an operator copied the downloaded document to external durable storage. The runbook must state this operational responsibility explicitly.

## Migration lock module

Create a focused internal module that owns the existing lock semantics:

- lock id `main`;
- default TTL 60 seconds;
- TTL bounded to 1 second through 10 minutes;
- fixed retry and delay bounds for acquisition;
- read-only inspection;
- stale cleanup and atomic insert during acquisition;
- owner-scoped renewal and release.

The existing startup migration path will use this module without changing behavior.

### Read-only lock inspection

Preflight executes one fixed query selecting only `acquired_at` for lock id `main`. It never selects or returns the owner.

States:

- `available`: no row exists;
- `held`: age is within TTL and blocks apply;
- `stale`: age exceeds TTL, does not block, and indicates the future apply may atomically reclaim it;
- `unavailable`: the lock state cannot be read and blocks apply;
- `not_required`: no migrations are pending, so the lock is not queried.

Preflight never deletes a stale row. Only the existing/future acquisition path may reclaim it atomically.

## Decision order

The evaluator uses one deterministic priority order so the public code is stable:

1. database unavailable;
2. journal invalid or unavailable;
3. applied-prefix schema incompatible or partial future apply;
4. no pending migrations (`not_required`);
5. quick check failed, unsupported, or unavailable;
6. qualifying backup missing, stale, incompatible, or unavailable;
7. active lock held or lock unavailable;
8. ready.

A stale lock is a non-blocking warning because the shared acquisition path reclaims stale rows using the same TTL immediately before attempting atomic insert.

## Audit

Best-effort action: `storage.migration.preflight`.

Audit metadata is limited to:

- top-level state, decision, and code;
- duration;
- current/latest versions;
- applied/pending counts;
- fixed schema, journal, integrity, backup, and lock codes;
- bounded backup age and lock age when available.

Do not record request headers, token, session, actor-provided input, lock owner, migration names, checksums, SQL, object names, raw drift, raw quick-check output, backup metadata, database path, or exception text.

Audit persistence failure must not replace the diagnostic response.

## CLI

Add:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='from-secret-provider' \
npm run inspect:storage-migration-preflight
```

CLI requirements:

- use the same HTTP API, not a second database implementation;
- token only from `ADMIN_TOKEN` environment variable;
- reject token/header/password/cookie/authorization arguments;
- accept only root `PORTAL_URL` / `--url` and bounded `--timeout-ms` (500–30000);
- issue exact `POST` with body `{}`;
- disable redirects;
- validate exact response keys, states, decision/code consistency, bounded integers, correlation ID, and check-code combinations;
- never print token, target URL, redirect location, raw body, raw exception, headers, SQL, or internal identifiers.

Exit codes:

- `0`: valid `ready` or `not_required` response;
- `2`: valid `blocked` or `unavailable` response, or safe server failure;
- `3`: authentication/authorization failure;
- `4`: timeout/network failure;
- `5`: arguments, URL, redirect, media type, status/contract mismatch, or unsafe payload.

## Query and cardinality bounds

- journal rows bounded by compile-time registry length plus one overflow detector;
- schema-object inventory bounded to canonical and pending-owned object classes;
- zero or one sanitized quick check;
- at most 20 backup audit candidates;
- zero or one lock row;
- fixed response cardinality;
- no request-controlled SQL, identifiers, filters, limits, pragmas, versions, or migration selection;
- process-local single-flight only; no completed-result cache because lock and backup age are time-sensitive.

## HTTP semantics

- `200`: valid `ready`, `not_required`, or `blocked` report;
- `400`: malformed/non-empty request;
- `401`/`403`: existing authentication/authorization semantics;
- `405`: method not allowed with `Allow: POST`;
- `413`: request too large;
- `503`: valid `unavailable` report or fixed safe unexpected failure;
- all responses use `Cache-Control: no-store`;
- diagnostic responses include the existing correlation ID header/body contract.

A safety block is a valid diagnostic result and therefore uses HTTP 200; automation must inspect `decision` and `state` rather than treating every block as a transport failure.

## Failure and recovery behavior

- no D1 binding: unavailable, no audit query attempt beyond best effort;
- missing journal/lock infrastructure: blocked or unavailable, never auto-created by preflight;
- journal gap/future version/checksum mismatch: blocked;
- applied-schema drift: blocked;
- future objects without journal: blocked as partial apply;
- no pending migrations: valid `not_required`; quick check, backup, and lock queries are skipped;
- quick check failure/unsupported: blocked;
- missing/stale/wrong-version/partial backup: blocked;
- active lock: blocked;
- stale lock: reported, non-blocking, not deleted;
- audit failure: response preserved;
- unexpected exception: full fixed versioned unavailable report, no raw error.

## Testing strategy

### Pure/service tests

- valid applied prefix with one pending migration;
- no pending migrations and proof that quick check/backup/lock queries are skipped;
- journal gap, future version, unknown version, checksum/name mismatch, duplicate/malformed rows;
- applied-prefix snapshot validation;
- expected pending objects absent without false drift;
- partial future table/index/trigger detection;
- missing migration snapshot blocks controlled eligibility;
- quick check healthy, failed, unsupported, unavailable, raw-output redaction;
- full current-version backup ready;
- partial-domain, duplicate-domain, malformed metadata, wrong-version, stale, missing, and unavailable backup;
- lock available, held, exactly-at-TTL, stale, malformed, unavailable;
- same TTL used by inspect and acquire paths;
- single-flight and no completed cache;
- deterministic decision priority and bounded fields.

### API tests

- exact path and POST-only behavior;
- strict empty-body validation and request-size bound;
- admin success;
- viewer/operator denial before D1;
- local-session and same-origin boundaries;
- exact service-admin token boundary;
- recovery routing through schema and maintenance gates;
- fixed 200 blocked report versus 503 unavailable report;
- correlation ID, no-store, safe audit, audit failure tolerance;
- full safe unexpected-failure contract;
- no secret, owner, checksum, SQL, object name, raw drift, backup metadata, or raw error leakage.

### CLI tests

- argument parsing and forbidden secret arguments;
- exact POST/body/headers/redirect mode;
- ready, not-required, blocked, unavailable, auth, timeout, network, redirect, malformed media type, malformed JSON, extra fields, invalid code/state combinations, and unsafe counts;
- stdout/stderr redaction.

### Regression contracts

- existing startup migration acquisition/application behavior remains unchanged;
- storage status and storage integrity contracts remain unchanged;
- health/readiness/liveness and Docker HEALTHCHECK remain unchanged;
- settings/session/scheduled delegation composition remains unchanged;
- Auth E2E and full server suite pass on the exact PR head.

## Documentation

Add an operator runbook explaining:

- what each decision/check code means;
- how to create a qualifying full encrypted backup;
- why an exported document must be stored externally by the operator;
- how active versus stale locks are interpreted;
- why preflight does not apply or reserve a migration;
- that future apply will rerun preflight under lock;
- safe CLI usage and exit codes;
- no manual deletion of an active lock.

## Follow-up checkpoints

This PR leaves #44 open. Later isolated checkpoints are:

1. controlled apply that reruns preflight, atomically acquires the shared lock, enters maintenance mode, records progress, and applies only compile-time pending migrations;
2. interruption/recovery state and readiness integration;
3. Storage Center UI;
4. optional destructive migration approval workflow, only when an actual destructive migration exists.
