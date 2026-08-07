# Controlled storage migration apply design

Date: 2026-08-06  
Issue: #44  
Branch: `agent/storage-migration-controlled-apply`

## Summary

Add a server-controlled workflow for applying canonical portal migrations. Mutation is allowed only while maintenance is active, after the shared migration lock is acquired and the complete safety preflight is rerun under that owner lease.

This is the fourth isolated checkpoint for #44 after storage status, read-only integrity diagnostics, and read-only migration preflight.

The checkpoint also changes startup behavior: bootstrap migrations remain automatic, while future product migrations are explicitly `controlled` and cannot be applied by normal startup.

## Problem

The current startup path applies every pending canonical migration. Adding an administrative `/apply` route without changing startup would not enforce backup or maintenance requirements because startup could execute the migration first.

The public preflight is intentionally advisory and read-only. Its result cannot authorize later mutation because journal, schema, backup age, integrity, and lock state may change between requests.

The controlled workflow must therefore:

- separate automatic bootstrap migrations from controlled product migrations;
- stop startup before the first controlled migration;
- block normal application traffic while controlled migrations are pending;
- require an active maintenance controller;
- acquire the shared lock and rerun safety checks under that lock;
- persist bounded operation state and audit evidence;
- apply only the compile-time contiguous controlled suffix;
- fail closed after interruption or partial application;
- provide status and explicit reconciliation without executing repair SQL;
- reject arbitrary SQL, target versions, migration selection, force, and bypass controls.

## Goals

1. Preserve automatic clean-install bootstrap.
2. Make future product schema upgrades operator-controlled.
3. Reuse the canonical registry, applied-prefix inspector, quick check, backup evidence, maintenance controller, audit log, and shared lock.
4. Ensure every mutating decision is recomputed under an owner-scoped lease.
5. Persist enough bounded state to diagnose success, failure, and interruption without exposing migration internals.
6. Support strict HTTP CLIs when the browser UI is unavailable.

## Non-goals

- Storage Center UI;
- a real production controlled migration version 5;
- arbitrary SQL or uploaded migration files;
- client-selected targets or migration subsets;
- destructive migrations;
- rollback or restore execution;
- automatic continuation after partial application;
- background jobs, queues, polling workers, or webhooks;
- automatic maintenance exit;
- journal, drift, or schema repair.

Tests may inject controlled migrations to exercise the engine. Production ends at automatic foundation version 4 in this checkpoint.

## Selected architecture

Each canonical migration declares:

```ts
mode: "automatic" | "controlled";
```

Automatic migrations form a strict contiguous prefix. Once the first controlled migration appears, every later migration must also be controlled. This prevents startup from skipping a controlled migration and applying a later automatic one.

Versions 1–3 become `automatic` metadata-only updates. Their names, statements, snapshots, and checksum material do not change. Version 4 is a new automatic foundation migration that creates bounded operation state required by the controlled workflow.

Disabling all automatic migrations was rejected because authentication, maintenance, and operation infrastructure must exist on clean install. Keeping current automatic application was rejected because it would bypass the new safety workflow.

## Registry invariants

The registry must enforce:

1. strictly increasing contiguous versions;
2. an automatic prefix followed by an optional controlled suffix;
3. no automatic migration after a controlled migration;
4. a deterministic snapshot for every controlled migration;
5. checksum material remains only version, name, and statements;
6. request data cannot add, remove, reorder, rename, or select migrations.

Registry invariant failure is a fixed fail-closed error and never applies SQL.

## Foundation migration version 4

Version 4 creates `portal_migration_operations` with one canonical row identified by `id = "main"`.

Stored fields:

- `operation_id`, generated server-side as `migration_<uuid>`;
- `maintenance_operation_id`;
- `from_version`;
- `target_version`;
- `total_count`;
- `applied_count`;
- `state`;
- `created_at`;
- `started_at`;
- `updated_at`;
- `completed_at`;
- `failure_code`.

Stored states:

- `running` — mandatory start evidence and operation row were committed atomically while the lock was owned;
- `succeeded` — final journal, schema, quick check, operation state, and completion audit were committed successfully;
- `failed` — deterministic failure or ambiguous post-mutation state requires operator action;
- `interrupted` — reconciliation proved no controlled migration was journaled and no pending-owned object appeared;
- `reconciled` — reconciliation proved the complete target is valid.

`idle` is a public projection when no row exists, not a stored state.

The table never stores actor identity, groups, controller secret or hash, admin token, SQL, checksums, migration names, object names, backup metadata, raw errors, database paths, request bodies, or lock owners.

The single-row design bounds persistent operational state. Historical evidence remains in the append-only audit log.

## Startup and schema status

Startup changes as follows:

1. validate the journal against the compile-time registry;
2. validate the cumulative snapshot for the applied prefix;
3. apply pending automatic migrations in order using the existing owner-scoped lock;
4. stop before the first pending controlled migration;
5. return new schema state `pending` with code `schema_migration_pending` when a controlled suffix remains;
6. never acquire a lock merely to report that controlled migrations are pending.

`PortalSchemaState` gains `pending`.

For pending state:

- `currentVersion` is the last journaled version;
- `latestVersion` is the registry latest version;
- `pendingVersions` contains the controlled suffix;
- only versions, counts, and fixed codes are public;
- names, checksums, SQL, object names, and raw drift remain internal.

The normal API and scheduled work are blocked while state is pending. Exact recovery routes remain reachable but retain their own authorization:

- health and schema status;
- storage status and integrity;
- migration preflight;
- maintenance control;
- controlled apply;
- apply status;
- reconcile.

Readiness reports `schema_migration_pending`; liveness remains unaffected.

The hardened schema inspector must validate the applied-prefix snapshot when controlled migrations are pending, rather than incorrectly requiring latest controlled objects before they are applied.

## Maintenance controller requirement

Apply and reconcile require the existing maintenance state machine.

Server-side checks:

- maintenance row exists and is structurally valid;
- state is exactly `active` for apply;
- reconcile accepts only `active` or `failed` for the same operation;
- request maintenance operation ID matches the row;
- controller secret passes the existing constant-time hash verifier;
- operation is not expired;
- confirmation matches the server-computed current and target versions.

The migration workflow never prepares, enters, verifies, exits, completes, or cancels maintenance automatically.

After success, maintenance remains active for the existing verification and exit process. After failure or ambiguity it remains recovery-required and may be moved to the fixed `failed` state.

## Public API

### Apply

`POST /api/admin/storage/migrations/apply`

Exact body, maximum 4 KiB:

```json
{
  "maintenanceOperationId": "maintenance_00000000-0000-4000-8000-000000000000",
  "controllerSecret": "base64url-controller-secret",
  "confirmation": "APPLY:maintenance_00000000-0000-4000-8000-000000000000:4:5"
}
```

The current and target versions are not separate fields. The server computes them from the valid journal and registry and requires:

```text
APPLY:<maintenanceOperationId>:<currentVersion>:<latestVersion>
```

Unknown or missing fields, arrays, null, malformed JSON, and oversized streaming bodies are rejected.

The endpoint never accepts migration names, IDs, versions, arrays, SQL, object identifiers, lock settings, backup identifiers, force, bypass, dry-run, or arbitrary target fields.

### Status

`GET /api/admin/storage/migrations/apply/status`

Returns only the sanitized canonical operation projection:

- contract version;
- state;
- operation ID;
- from/current/target versions;
- applied/total counts;
- bounded timestamps;
- fixed failure code;
- recovery-required flag;
- correlation ID.

Status is read-only. It never changes operation state, deletes a stale lock, changes maintenance, applies SQL, or performs reconciliation.

When no row exists, return fixed `idle` with null identifiers/timestamps and zero counts.

### Reconcile

`POST /api/admin/storage/migrations/apply/reconcile`

Exact body, maximum 4 KiB:

```json
{
  "maintenanceOperationId": "maintenance_00000000-0000-4000-8000-000000000000",
  "controllerSecret": "base64url-controller-secret",
  "confirmation": "RECONCILE:maintenance_00000000-0000-4000-8000-000000000000"
}
```

Reconcile verifies the maintenance controller, acquires the shared lock, classifies journal/schema/integrity state, updates the bounded operation row, and appends audit evidence. It never executes migration SQL, repairs the journal, deletes schema objects, restores data, or exits maintenance.

## Authorization and routing

All three routes are admin-only.

Local mode:

- resolve the local session before body parsing or D1 work;
- reject viewer, operator, anonymous, disabled, and expired sessions;
- apply and reconcile require the existing same-origin mutation boundary;
- status GET still requires admin authentication but not mutation-origin validation.

Service administration:

- require the existing constant-time `ADMIN_TOKEN` check on the exact paths;
- reject missing or invalid tokens before body parsing or D1 work;
- strip untrusted forwarded administrative headers before delegation.

Schema and maintenance recovery gates route exact paths only and never bypass authorization. Near-match paths and subpaths remain rejected.

## Controlled apply sequence

The implementation is synchronous within one request. No work continues in the background after the request ends.

Execution order:

1. authorize admin and validate exact bounded body;
2. verify active maintenance controller;
3. validate registry and journal and compute the controlled suffix and confirmation;
4. reject no-pending, automatic-pending, invalid registry, or an unreconciled prior operation;
5. acquire the shared migration lock with server-fixed bounded options;
6. rerun complete preflight under the acquired owner lease;
7. atomically write operation state `running` and mandatory audit event `storage.migration.apply.started` in one D1 batch;
8. if that batch fails, execute no migration SQL;
9. apply controlled migrations in registry order using compile-time statements only;
10. for each migration, commit its journal entry, operation progress, and progress audit in the same terminal migration batch;
11. renew the owner lease before and after every mutation stage;
12. verify final journal, latest canonical schema, and sanitized `PRAGMA quick_check(1)`;
13. atomically commit operation state `succeeded` and audit event `storage.migration.apply.completed` in one D1 batch;
14. release the lock by owner in `finally`;
15. leave maintenance active.

There is no process-local request coalescing. Every request authenticates independently, and the shared database lock is the sole concurrency authority. Completed results are never cached.

## Atomic audit integration

The current audit module inserts one sanitized audit row. Extract an internal helper that prepares the fixed audit insert statement without exposing unsanitized values.

Use it only with server-built safe metadata so these boundaries can be atomic:

- operation `running` plus start audit;
- journal entry plus progress count plus progress audit;
- operation `succeeded` plus completion audit;
- operation failure transition plus failure audit when the database remains writable;
- reconciliation transition plus reconciliation audit.

A clean success state must never be committed without matching terminal audit evidence. If a post-mutation terminal batch fails, leave the operation non-terminal/recovery-required and let reconcile determine actual journal/schema state.

If the database is unavailable and failure state cannot be persisted, return a fixed safe failure; the stale/non-terminal row and lock age provide recovery evidence later.

## Locked preflight

Refactor the read-only preflight into a shared internal evaluator with two modes.

Public mode:

- read-only lock inspection;
- held lock blocks;
- stale lock is reported but not deleted.

Controlled mode:

- callable only after lock acquisition;
- receives an opaque internal owner value, never request data;
- proves ownership using owner-scoped renewal;
- skips public lock inspection;
- reruns the same journal, applied-prefix schema, partial-future, quick-check, and backup decisions;
- returns fixed `migration_apply_lock_lost` if renewal fails before mutation.

No owner value is returned, stored, audited, or printed.

A previous public preflight result is never accepted as authorization, lease, cache entry, or request input.

## Eligible migrations

A migration is eligible only when it is:

- in the compile-time registry;
- marked `controlled`;
- part of the contiguous pending suffix;
- preceded by a valid complete applied prefix;
- backed by a deterministic snapshot;
- allowed by locked preflight;
- not blocked by an unreconciled prior operation.

The engine never evaluates request-provided SQL or identifiers.

Execution retains hardened migration behavior:

- table statements use a bounded batch;
- lease renewal surrounds mutation stages;
- table structure is verified before secondary objects;
- secondary objects, journal row, progress update, and progress audit use one bounded batch;
- checksum comes from compile-time material;
- cumulative canonical schema is inspected after each journaled migration.

If interruption occurs after table creation but before journal commit, future preflight detects pending-owned objects without a journal entry. Reconcile marks restore-required and never auto-continues.

## Backup requirement

Locked preflight requires the same recovery point as public preflight:

- action exactly `backup.encrypted.export.completed`;
- outcome `success`;
- resource type `portal-backup`;
- every backup domain exactly once;
- schema version equal to the current applied version before migration;
- age no greater than 24 hours;
- newest 20 candidates maximum.

Wrong-version, stale, partial, duplicate-domain, malformed, or unavailable evidence blocks apply.

Audit evidence proves export generation, not durable external custody. The runbook must preserve that warning.

## Operation and concurrency rules

The lock is the mutation authority.

- concurrent apply requests cannot both acquire it;
- a loser returns `migration_apply_busy` and does not create or overwrite an operation row;
- renewal is required between stages;
- owner-scoped release cannot remove another lease;
- progress counts only journaled migrations;
- succeeded/reconciled targets cannot be reapplied;
- running, failed, or interrupted state requires reconciliation before replacement unless failure is proven pre-mutation and the row is atomically replaced under a new owned lock;
- a stale confirmation cannot authorize a changed suffix because current/latest versions are recomputed after lock acquisition.

The operation row uses optimistic expected-state updates. Unexpected row state or operation ID fails closed.

## Failure behavior

Before SQL mutation:

- invalid auth, origin, body, maintenance controller, confirmation, registry, journal, schema, integrity, backup, lock, or start-audit batch applies nothing;
- lock is owner-released when acquired;
- no arbitrary retry or fallback occurs.

During migration:

- lease loss stops before the next mutation stage;
- D1 failure returns only a fixed code;
- progress reflects only atomic journal/progress/audit commits;
- partial future objects force restore-required classification;
- maintenance never exits automatically.

After SQL mutation:

- latest journal, latest schema, and quick check must pass;
- success state and completion audit commit atomically;
- otherwise operation remains recovery-required for reconcile.

Raw D1, crypto, parsing, and exception messages are discarded.

## Reconciliation outcomes

Reconcile requires the same maintenance controller and an acquired lock.

### Fully applied and valid

Target journal entries, names/checksums, latest canonical schema, and quick check are valid.

Result: atomically mark `reconciled` and append terminal reconciliation audit. Maintenance stays active for normal verification/exit.

### No controlled mutation committed

Journal remains at `from_version`, no pending-owned object exists, applied-prefix schema is valid, and quick check is healthy.

Result: mark `interrupted`. A later apply may replace the row only under a newly acquired lock, fresh locked preflight, and fresh exact confirmation.

### Partial or ambiguous mutation

Any of these is restore-required:

- pending-owned table/index/trigger exists without its journal entry;
- target suffix is only partly journaled;
- journal gap, checksum mismatch, or future version;
- canonical schema incompatible;
- quick check failed or unavailable after mutation.

Result: atomically mark `failed` with `migration_reconcile_restore_required` and append audit. Do not continue SQL.

### Lock held

Another active lease returns `409 migration_reconcile_busy` and changes nothing.

Status may project that a running operation has a missing or stale lease, but only reconcile may mutate the stored state.

## Safe codes

Initial fixed codes include:

- `migration_apply_request_invalid`;
- `migration_apply_request_too_large`;
- `migration_apply_method_not_allowed`;
- `migration_apply_forbidden`;
- `migration_apply_origin_forbidden`;
- `migration_apply_database_unavailable`;
- `migration_apply_maintenance_required`;
- `migration_apply_controller_invalid`;
- `migration_apply_confirmation_required`;
- `migration_apply_not_required`;
- `migration_apply_registry_invalid`;
- `migration_apply_preflight_blocked`;
- `migration_apply_busy`;
- `migration_apply_lock_lost`;
- `migration_apply_operation_conflict`;
- `migration_apply_partial_state`;
- `migration_apply_audit_unavailable`;
- `migration_apply_failed`;
- `migration_reconcile_not_required`;
- `migration_reconcile_busy`;
- `migration_reconcile_restore_required`;
- `migration_reconcile_failed`.

No raw internal message is public or audited.

## HTTP semantics

Apply:

- `200` successful verified apply;
- `400` malformed/non-exact body;
- `401/403` authentication, authorization, or same-origin failure;
- `405` with `Allow: POST`;
- `409` maintenance/controller/operation/lock conflict or no pending migration;
- `413` oversized body;
- `422` confirmation mismatch or deterministic preflight block;
- `503` database, audit, or required safety dependency unavailable;
- `500` normalized unexpected post-boundary failure.

Status:

- `200` sanitized operation or idle projection;
- `401/403` authorization failure;
- `405` with `Allow: GET`;
- `503` operation state unavailable.

Reconcile:

- `200` reconciliation classification committed;
- equivalent fixed `400/401/403/405/409/413/503` boundary failures.

All responses use `Cache-Control: no-store`. Correlation ID is included whenever an audit context exists.

## CLI

Add strict HTTP commands:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='from-secret-provider' \
MAINTENANCE_OPERATION_ID='maintenance_...' \
MAINTENANCE_CONTROLLER_SECRET='from-secret-provider' \
MIGRATION_APPLY_CONFIRMATION='APPLY:maintenance_...:4:5' \
npm run apply:storage-migrations
```

Also add:

- `npm run inspect:storage-migration-apply-status`;
- `npm run reconcile:storage-migrations` using `MIGRATION_RECONCILE_CONFIRMATION`.

Requirements:

- secrets from environment only;
- reject token, cookie, authorization, secret, password, and header CLI arguments;
- root-origin `PORTAL_URL` only, without credentials/path/query/fragment;
- timeout 500–30000 ms;
- redirects disabled;
- exact media type and response validation;
- print only validated sanitized JSON;
- never print URL, token, controller secret, raw body, redirect location, headers, exception text, SQL, migration names, checksums, or object names.

Exit codes:

- `0` successful apply/reconcile or valid idle/succeeded status;
- `2` safe operational block, failed/interrupted/restore-required status, or normalized unavailable response;
- `3` authentication/authorization failure;
- `4` network/timeout failure;
- `5` arguments, URL, redirect, media type, response-contract, or unsafe-payload failure.

## Bounds

- compile-time registry only;
- journal bounded by registry length plus one overflow row;
- schema inventory bounded by the existing 1001-row detector;
- at most one locked preflight and one final quick check;
- at most 20 backup candidates;
- one lock row with existing retry/TTL bounds;
- one operation row;
- 4 KiB request bodies;
- fixed response cardinality;
- no request-controlled query, identifier, pragma, limit, retry count, lock TTL, migration set, or target version;
- no request coalescing and no completed-result cache.

## Testing strategy

### Registry/startup

- historical checksums unchanged;
- automatic-prefix invariant;
- controlled migration without snapshot rejected;
- clean install applies versions 1–4;
- startup stops before injected controlled suffix;
- controlled statements never run at startup;
- pending state and exact recovery gates;
- readiness pending, liveness unchanged.

### Operation/audit repository

- exact v4 schema and one-row bound;
- optimistic state transitions;
- invalid rows fail closed;
- sanitized prepared audit statement;
- atomic running/start audit;
- atomic journal/progress/audit;
- atomic success/completion audit;
- forbidden data never stored.

### Apply service

- no pending controlled migration;
- one and multiple injected controlled migrations;
- registry invariant failures;
- inactive/wrong/expired maintenance controller;
- wrong secret and stale confirmation;
- lock busy, stale reclaim, exact TTL, lease loss, owner release;
- locked preflight reruns every safety check;
- public preflight cannot authorize apply;
- backup changes between requests;
- journal/schema changes before lock;
- final journal/schema/quick-check verification;
- no request-controlled SQL or target;
- no coalescing/cache.

### Failure injection

- failure before table batch;
- failure after table batch before journal batch;
- failure during atomic journal/progress/audit batch;
- failure after final verification before terminal batch;
- stale running operation;
- partial table/index/trigger;
- journal gap/checksum/future version;
- fully valid target reconciliation;
- no-mutation interruption;
- reconcile never executes migration SQL.

### API/routing

- exact paths/methods;
- exact keys and streaming size bound;
- viewer/operator/anonymous denied before body/D1;
- local same-origin before body/D1;
- service token before body/D1;
- status read-only;
- schema-pending and maintenance recovery routing;
- near-match rejection;
- fixed codes, no-store, correlation ID, redacted audit.

### CLI/full regression

- environment-only secrets and exact HTTP protocol;
- strict contract/exit-code/redaction tests;
- lint and production build;
- complete server suite;
- per-file matrix;
- Auth E2E including Chromium scenarios;
- existing storage, backup, maintenance, schema, health, and recovery regressions.

## Documentation

Update storage operations, migration preflight, maintenance workflow, CLI examples, startup semantics, recovery matrix, roadmap, and issue #44 evidence.

Runbooks must state:

- public preflight is advisory;
- apply reruns checks under lock;
- maintenance remains active after success;
- success and terminal audit are atomic;
- partial/ambiguous application requires restore, not auto-continuation;
- backup audit proves export generation, not durable external custody;
- no force or bypass path exists.

## Completion criteria

The checkpoint is complete when:

1. migration modes and automatic-prefix invariant are enforced;
2. production versions 1–4 bootstrap automatically and no production controlled v5 is introduced;
3. startup stops before controlled migrations and returns pending;
4. apply requires maintenance, exact confirmation, lock, and locked preflight;
5. operation progress and required audit evidence are atomic and bounded;
6. request-controlled SQL/target selection is impossible;
7. interruption and partial application fail closed;
8. reconcile classifies but never applies or repairs SQL;
9. routes and CLIs are strict and redacted;
10. operations documentation is updated;
11. exact-head CI, full suite, matrix, and Auth E2E are green;
12. the focused PR is reviewed and merged while #44 remains open for the Storage Center UI and future real controlled migrations.
