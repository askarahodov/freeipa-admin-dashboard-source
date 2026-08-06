# Controlled storage migration apply design

Date: 2026-08-06  
Issue: #44  
Branch: `agent/storage-migration-controlled-apply`

## Summary

Add a server-controlled migration application workflow for canonical portal migrations. The workflow must require an active maintenance operation, a fresh recovery point, a healthy database, a valid canonical journal and schema, and an owner-scoped migration lock before any migration SQL is executed.

This is the fourth isolated checkpoint for #44 after storage status, read-only integrity diagnostics, and read-only migration preflight.

The checkpoint also changes startup migration semantics. Bootstrap migrations remain automatic, but future product migrations are explicitly marked `controlled` and can be applied only through the administrative workflow described here.

## Problem

The current startup path applies every pending canonical migration. A public administrative apply endpoint would therefore be ineffective: pending migrations could already have been executed during normal startup before an operator entered maintenance mode or verified a current backup.

The existing read-only preflight deliberately does not acquire a lock and is advisory. A controlled apply cannot trust an earlier preflight response because backup age, lock state, journal contents, and schema state can change between requests.

The new workflow must therefore:

- distinguish automatic bootstrap migrations from controlled product migrations;
- prevent startup from applying controlled migrations;
- block normal application traffic while a controlled migration is pending;
- require an active maintenance controller;
- acquire the shared lock and rerun all safety checks under that lock;
- persist bounded operation state before and during execution;
- apply only the compile-time contiguous controlled suffix;
- fail closed after interruption or partial application;
- support safe status and reconciliation when the original request disappears;
- never accept SQL, migration names, checksums, lock parameters, force flags, backup bypasses, or an arbitrary target version.

## Goals

1. Make future schema changes operator-controlled without breaking clean installation and bootstrap.
2. Reuse the canonical migration registry, shared lock implementation, applied-prefix schema inspector, quick check, backup evidence, audit, and maintenance controller.
3. Ensure every mutating decision is recomputed under an acquired owner-scoped lock.
4. Persist enough bounded state to diagnose success, failure, and interruption without exposing SQL or internal object names.
5. Provide strict HTTP and CLI recovery paths when the browser UI is unavailable.
6. Keep this checkpoint independent of the future Storage Center UI.

## Non-goals

- Storage Center UI;
- arbitrary SQL or uploaded migration files;
- client-selected target versions or migration subsets;
- destructive migrations;
- rollback or restore execution;
- automatic continuation after partial application;
- background queues, asynchronous jobs, polling workers, or webhooks;
- changing the existing backup payload format;
- a real controlled business migration in production registry version 5;
- automatic exit from maintenance after apply;
- repair of invalid journals, drift, or partially applied migration objects.

Tests may inject a controlled migration registry to exercise the engine. The production registry ends at automatic foundation migration version 4 in this checkpoint.

## Considered approaches

### A. Automatic bootstrap prefix plus controlled suffix — selected

Each migration declares `mode: "automatic" | "controlled"`. Automatic migrations form one contiguous registry prefix. Startup may apply only that prefix. Once the registry contains the first controlled migration, every later migration must also be controlled.

Advantages:

- clean installations continue to bootstrap without operator intervention;
- future product upgrades require explicit maintenance and backup checks;
- startup cannot silently skip a controlled migration and apply a later automatic migration;
- one compile-time registry remains authoritative.

Cost:

- schema status and gates gain an explicit pending-controlled state;
- migration registry definitions and tests must enforce the prefix invariant.

### B. Disable all automatic migration application — rejected

This is safe but makes clean installation and disaster recovery depend on a separate administrative workflow before authentication and maintenance infrastructure necessarily exist.

### C. Keep automatic startup application and add an apply endpoint — rejected

The endpoint would be advisory rather than authoritative because startup could execute the same migrations first. Backup and maintenance requirements would not be enforceable.

## Canonical migration modes

Extend `PortalMigration` with a required mode:

```ts
mode: "automatic" | "controlled";
```

Registry rules:

1. versions remain strictly increasing and contiguous;
2. versions 1 through 3 are updated to `automatic` without changing their names, statements, snapshots, or checksums;
3. version 4 is an automatic foundation migration introduced by this checkpoint;
4. automatic migrations must form a contiguous prefix;
5. after the first controlled migration, no automatic migration is allowed;
6. every controlled migration must provide a deterministic snapshot;
7. request data can never add, remove, reorder, rename, or select migrations.

Changing only the new `mode` metadata must not change historical checksums. Checksum material remains version, name, and statements.

## Foundation migration version 4

Version 4 creates one bounded operation-state table and its fixed index if needed.

Table: `portal_migration_operations`.

The table stores one canonical row with `id = "main"`:

- `operation_id` — generated server-side as `migration_<uuid>`;
- `maintenance_operation_id` — the active maintenance controller operation;
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

No actor identity, groups, controller secret or hash, token, SQL, checksum, migration name, object name, backup metadata, raw error, stack trace, database path, or lock owner is stored.

Allowed states:

- `prepared` — durable operation created before mutation;
- `running` — start audit succeeded and the lock was acquired;
- `succeeded` — target journal and schema verified after application;
- `failed` — deterministic safety or execution failure requires operator action;
- `interrupted` — an earlier `prepared` or `running` operation no longer has a valid owner lease and must be reconciled;
- `reconciled` — reconciliation proved the target is fully applied and valid.

The single-row design bounds persistent operational state. Historical evidence remains in the append-only audit log.

Version 4 is automatic because the operation table must exist before a controlled migration can be managed. It introduces no product-domain schema change.

## Startup and schema status semantics

Startup continues to call the hardened schema ensure path, but that path changes as follows:

1. validate the complete journal against the compile-time registry;
2. validate the schema snapshot for the applied prefix;
3. apply pending automatic migrations in order under the existing shared lock;
4. stop before the first pending controlled migration;
5. return a new schema state `pending` with safe code `schema_migration_pending` when controlled migrations remain;
6. never acquire a lock solely to report a controlled pending suffix after all automatic migrations are applied.

`PortalSchemaState` gains `pending`.

For `pending` status:

- `currentVersion` is the last applied version;
- `latestVersion` is the registry latest version;
- `pendingVersions` contains the controlled suffix;
- public output contains versions and fixed codes only;
- no migration names, checksums, SQL, object names, or raw drift are returned.

Normal API traffic and scheduled work are blocked while schema state is `pending`. The following exact recovery paths remain reachable but retain their own authentication and authorization:

- health and schema status;
- storage status;
- storage integrity;
- migration preflight;
- maintenance control paths;
- migration apply;
- migration apply status;
- migration reconcile.

Readiness reports the fixed pending code. Liveness remains unaffected.

## Maintenance requirement

Controlled apply requires the existing maintenance state to be `active`.

The apply handler verifies server-side:

- the maintenance row exists and is structurally valid;
- state is exactly `active`;
- request `maintenanceOperationId` matches the active row;
- controller secret matches the stored hash using the existing constant-time verifier;
- the maintenance operation is not expired;
- the confirmation string matches the server-computed current and target versions.

The apply workflow never prepares, enters, verifies, exits, completes, or cancels maintenance automatically.

On apply failure or interruption, maintenance remains active or is moved to `failed` using a fixed failure code. It never returns to `inactive` automatically.

## Public API

### Apply route

`POST /api/admin/storage/migrations/apply`

Exact request body:

```json
{
  "maintenanceOperationId": "maintenance_00000000-0000-4000-8000-000000000000",
  "controllerSecret": "base64url-controller-secret",
  "confirmation": "APPLY:maintenance_00000000-0000-4000-8000-000000000000:4:5"
}
```

The current and target versions are not separate request fields. They are computed from the journal and compile-time registry and embedded only in the exact confirmation string:

```text
APPLY:<maintenanceOperationId>:<currentVersion>:<latestVersion>
```

Unknown fields, missing fields, arrays, null, malformed JSON, duplicate semantic values, and bodies over 4 KiB are rejected.

The endpoint never accepts:

- migration IDs, names, versions, arrays, or target version fields;
- SQL or object identifiers;
- lock TTL, owner, retry, or force settings;
- backup identifiers or bypass flags;
- maintenance-state overrides;
- dry-run flags;
- arbitrary environment or header forwarding.

### Apply status route

`GET /api/admin/storage/migrations/apply/status`

Returns the sanitized canonical operation row:

```json
{
  "contractVersion": "1",
  "state": "running",
  "operationId": "migration_...",
  "fromVersion": 4,
  "currentVersion": 4,
  "targetVersion": 5,
  "appliedCount": 0,
  "totalCount": 1,
  "createdAt": 1786000000000,
  "startedAt": 1786000000100,
  "updatedAt": 1786000000100,
  "completedAt": null,
  "failureCode": null,
  "recoveryRequired": true,
  "correlationId": "cor_..."
}
```

When no operation exists, return a fixed `idle` projection with null identifiers/timestamps and zero counts.

Status is read-only and never deletes stale locks, modifies maintenance, or changes operation state.

### Reconcile route

`POST /api/admin/storage/migrations/apply/reconcile`

Exact request body:

```json
{
  "maintenanceOperationId": "maintenance_00000000-0000-4000-8000-000000000000",
  "controllerSecret": "base64url-controller-secret",
  "confirmation": "RECONCILE:maintenance_00000000-0000-4000-8000-000000000000"
}
```

Reconcile validates the maintenance controller, acquires the shared lock, and performs read-only journal/schema/integrity classification plus bounded operation-state updates and audit. It never executes migration SQL, deletes schema objects, repairs the journal, restores a backup, or exits maintenance.

## Authorization and routing

All routes are admin-only.

Local mode:

- resolve the authenticated local session first;
- viewer, operator, anonymous, and expired sessions are rejected before request-body parsing or D1 work;
- apply and reconcile require the existing same-origin administrative mutation boundary;
- status GET does not require same-origin mutation validation but still requires admin authentication.

Service administration:

- require the existing constant-time `ADMIN_TOKEN` boundary on the exact paths;
- reject missing or invalid tokens before body parsing or D1 work;
- strip untrusted forwarded administrative headers before delegation.

Schema and maintenance recovery gates may route the exact paths, but never bypass authorization.

Near-match paths and subpaths return the normal not-found behavior.

## Controlled apply execution

The implementation is synchronous within one request. No background work is promised or scheduled.

Execution order:

1. authorize admin and validate exact bounded body;
2. load and verify active maintenance controller;
3. load journal and compile-time registry;
4. compute contiguous pending controlled suffix and exact confirmation;
5. reject no-pending, automatic-pending, registry invariant failure, or an unreconciled prior operation;
6. write canonical operation state `prepared`;
7. append mandatory audit event `storage.migration.apply.started`;
8. if the start audit fails, mark the operation `failed` with `migration_apply_audit_unavailable` and execute no migration SQL;
9. acquire the shared migration lock with server-fixed bounded options;
10. mark operation `running`;
11. renew the owner lease and rerun the complete preflight under lock;
12. the locked preflight repeats journal, applied-prefix schema, partial-future, quick-check, and qualifying-backup checks;
13. instead of inspecting the public lock state, the locked preflight proves ownership by owner-scoped renewal;
14. apply each pending controlled migration in registry order using compile-time statements only;
15. after each migration, verify the journal entry and cumulative schema snapshot, update `applied_count`, update `updated_at`, and renew the lock;
16. after the final migration, verify latest journal, latest canonical schema, and sanitized `PRAGMA quick_check(1)`;
17. mark the operation `succeeded` and append `storage.migration.apply.completed`;
18. release the lock by owner in `finally`;
19. leave maintenance active for the existing verification and exit workflow.

A previous public preflight response is never accepted as proof or as a lease. The internal locked preflight shares the same decisions but receives no request-controlled override.

## Migration execution boundary

Only migrations satisfying all of these conditions are eligible:

- present in the compile-time registry;
- mode is `controlled`;
- version belongs to the contiguous pending suffix;
- all earlier registry versions are journaled and valid;
- deterministic snapshot is present;
- preflight under lock returns allow;
- no previous unreconciled operation blocks execution.

The engine never evaluates request-provided SQL or identifiers.

Each migration keeps the existing hardened execution behavior:

- table statements are applied in a bounded batch;
- owner lease is renewed before and after mutation stages;
- table structure is verified before secondary objects;
- secondary objects and journal entry are committed in the existing bounded batch;
- journal checksum is calculated from compile-time material;
- final cumulative schema inspection uses the canonical inspector.

If execution stops after table creation but before the journal entry, future preflight detects partial future objects and blocks. Reconcile does not automatically continue that migration.

## Locked preflight

Extract a shared internal evaluator from the read-only preflight implementation.

Public preflight mode:

- read-only lock inspection;
- `held` blocks;
- stale lock is reported but not deleted.

Controlled apply mode:

- called only after acquisition;
- requires an opaque internal owner value supplied by the apply service, never the request;
- verifies lease ownership using `renewPortalMigrationLock`;
- skips the public lock inspection query;
- otherwise executes the same journal, schema, partial-future, quick-check, and backup decisions;
- any lease-renew failure returns fixed block `migration_apply_lock_lost` before further mutation.

No owner value is returned, audited, or stored in the operation table.

## Backup requirement

The locked preflight requires the same qualifying backup as public preflight:

- exact completed encrypted-export audit action;
- successful outcome;
- resource type `portal-backup`;
- all backup domains exactly once;
- schema version equal to the current applied version before migration;
- age no greater than 24 hours;
- fixed newest-20 lookup bound.

A backup created for a newer, older, partial, duplicated, malformed, or unknown domain set does not qualify.

The audit record proves export generation completed. The runbook must continue to state that durable external storage is an operator responsibility.

## Audit semantics

Apply is not allowed to begin SQL mutation unless the start audit event is durably appended.

Actions:

- `storage.migration.apply.started`;
- `storage.migration.apply.progress` after each successfully journaled migration;
- `storage.migration.apply.completed`;
- `storage.migration.apply.failed`;
- `storage.migration.reconcile.started`;
- `storage.migration.reconcile.completed`;
- `storage.migration.reconcile.failed`.

Safe metadata only:

- operation state;
- from/current/target versions;
- applied and total counts;
- fixed preflight and failure codes;
- bounded duration and timestamps;
- maintenance state;
- whether recovery is required.

Never audit controller secret or hash, admin token, request headers/body, SQL, migration name, checksum, lock owner, object name, raw drift, quick-check output, backup metadata, path, actor-provided free text, exception text, or stack trace.

If a progress or terminal audit fails after SQL mutation, the operation is marked `failed` with `migration_apply_audit_incomplete`, maintenance remains recovery-required, and reconcile must establish the actual journal/schema result. The system never claims clean success without terminal durable evidence.

## Safe failure codes

Public errors use fixed codes only. Initial set:

- `migration_apply_method_not_allowed`;
- `migration_apply_request_invalid`;
- `migration_apply_request_too_large`;
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
- `migration_apply_audit_incomplete`;
- `migration_apply_failed`;
- `migration_reconcile_not_required`;
- `migration_reconcile_busy`;
- `migration_reconcile_restore_required`;
- `migration_reconcile_failed`.

Raw D1, crypto, fetch, parsing, and exception messages are discarded.

## Failure behavior

Before SQL mutation:

- invalid auth, origin, body, maintenance controller, confirmation, journal, schema, integrity, backup, lock, registry, or audit returns a fixed failure and applies nothing;
- operation state is absent or terminal `failed` as appropriate;
- maintenance remains active or is marked failed;
- no arbitrary retry is performed.

During migration:

- lock-renew failure stops before the next mutation stage;
- D1 failure marks the operation failed with a fixed code;
- operation progress reflects only journaled migrations;
- partial future objects without a journal force restore-required classification;
- owner-scoped release is attempted in `finally`;
- maintenance never exits automatically.

After migration SQL:

- latest journal, latest schema, and quick check must all pass;
- terminal audit must succeed before a clean `succeeded` response;
- otherwise the operation remains recovery-required and reconcile determines actual state.

## Interruption and reconciliation

An operation in `prepared` or `running` is considered potentially interrupted when:

- no active matching owner lease can be proven by the new request;
- the request that created the operation is no longer running;
- status is read-only and therefore does not mutate it automatically.

Reconcile is explicit and requires the same maintenance controller.

Under the acquired lock, reconcile classifies:

### Fully applied and valid

- target journal versions are present with valid names/checksums;
- latest canonical schema is valid;
- quick check is healthy;
- no unexpected future version exists.

Result: mark `reconciled`, set completed timestamp, append terminal audit, keep maintenance active for normal verification/exit.

### No controlled migration applied

- journal remains at `from_version`;
- no pending-owned objects exist;
- applied-prefix schema and quick check are healthy.

Result: mark `interrupted`; a new apply may replace the state only after a fresh locked preflight and explicit confirmation.

### Partial or ambiguous mutation

- pending-owned objects exist without matching journal;
- journal is a gap, checksum mismatch, future version, or target is only partly journaled;
- canonical schema is incompatible;
- quick check fails or is unavailable after mutation.

Result: mark `failed` with `migration_reconcile_restore_required`; keep maintenance failed/recovery-required; do not execute or continue migration SQL.

### Lock held

If another active owner holds the lock, return `409 migration_reconcile_busy` and do not modify operation state.

## HTTP semantics

Apply:

- `200` — controlled suffix applied and terminally verified;
- `400` — malformed or non-exact body;
- `401`/`403` — existing authentication/authorization and origin semantics;
- `405` — method not allowed with `Allow: POST`;
- `409` — maintenance/controller/operation/lock conflict or no pending controlled migration;
- `413` — body too large;
- `422` — confirmation mismatch or deterministic preflight block;
- `503` — database, audit, or required safety dependency unavailable;
- `500` — fixed unexpected apply failure after safe normalization.

Status:

- `200` — exact sanitized status or idle projection;
- `401`/`403` — authorization failure;
- `405` — method not allowed with `Allow: GET`;
- `503` — operation state unavailable.

Reconcile:

- `200` — reconciled, interrupted-without-mutation, or restore-required classification completed;
- `400`, `401`, `403`, `405`, `409`, `413`, `503` — equivalent fixed boundary failures.

All responses use `Cache-Control: no-store`. Successful and normalized failure responses include correlation ID where an audit context exists.

## CLI

Add strict HTTP CLIs that reuse the public API:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='from-secret-provider' \
MAINTENANCE_OPERATION_ID='maintenance_...' \
MAINTENANCE_CONTROLLER_SECRET='from-secret-provider' \
MIGRATION_APPLY_CONFIRMATION='APPLY:maintenance_...:4:5' \
npm run apply:storage-migrations
```

Additional commands:

- `npm run inspect:storage-migration-apply-status`;
- `npm run reconcile:storage-migrations` with `MIGRATION_RECONCILE_CONFIRMATION`.

CLI requirements:

- secrets only from environment variables;
- reject token, cookie, authorization, controller-secret, password, and header CLI arguments;
- root-origin `PORTAL_URL` only, without path, query, fragment, or credentials;
- timeout bounded to 500–30000 ms;
- redirects disabled;
- exact media type and response-contract validation;
- print only validated sanitized JSON;
- never print URL, token, controller secret, raw response body, redirect location, headers, exception text, SQL, migration names, checksums, or object identifiers.

Exit codes:

- `0` — successful apply/reconcile or valid idle/succeeded status;
- `2` — safe operational block, failed/interrupted/restore-required status, or normalized unavailable response;
- `3` — authentication/authorization failure;
- `4` — network or timeout failure;
- `5` — arguments, URL, redirect, media type, response-contract, or unsafe-payload failure.

## Query and cardinality bounds

- registry is compile-time and bounded;
- journal queries are bounded by registry length plus one overflow detector;
- schema inventory is bounded by the existing 1001-row overflow detector;
- quick check executes at most once per preflight stage and once after final apply;
- backup evidence examines at most 20 candidates;
- lock inspection/acquisition uses one canonical row and existing retry bounds;
- operation state uses one canonical row;
- request body is at most 4 KiB;
- response cardinality is fixed;
- one process-local in-flight apply per D1 binding coalesces duplicate identical execution attempts, but completed results are never cached;
- no request-controlled query, identifier, pragma, limit, migration set, retry count, lock TTL, or target version.

## Concurrency and idempotency

The migration lock is the mutation authority.

- concurrent apply requests cannot both acquire the lock;
- a request that loses the race returns `migration_apply_busy` and cannot execute SQL;
- owner-scoped renewal is required between stages;
- owner-scoped release cannot remove another request's lease;
- the operation row records only journaled progress;
- a repeated request after `succeeded` returns not-required/conflict and does not reapply migrations;
- a repeated request after `prepared`, `running`, `failed`, or `interrupted` requires reconcile before a new operation can replace state;
- confirmation is recomputed from current journal and latest registry, so a stale confirmation cannot authorize a changed migration suffix.

## Testing strategy

### Registry and startup tests

- historical checksums unchanged after mode metadata;
- automatic prefix invariant;
- controlled migration without snapshot rejected;
- clean install applies versions 1–4 automatically;
- startup applies pending automatic migrations but stops before controlled suffix;
- state is `pending` with fixed code;
- startup never executes controlled statements;
- normal API and scheduled gates block pending state;
- recovery allowlists remain exact and authorized.

### Operation repository tests

- version 4 schema exactness;
- one canonical row;
- exact state transitions and optimistic expected-state updates;
- counts and timestamps bounded;
- invalid stored rows fail closed;
- secrets, SQL, checksums, names, object identifiers, actor identity, and raw errors are not stored.

### Apply service tests

- no pending controlled migration;
- successful injected controlled migration;
- multiple contiguous controlled migrations;
- automatic migration in controlled suffix rejected;
- maintenance inactive, wrong operation, expired controller, wrong secret, and wrong confirmation;
- mandatory start audit failure executes no SQL;
- lock busy, stale reclaim, exactly-at-TTL, renewal loss, owner-scoped release;
- locked preflight reruns journal/schema/integrity/backup;
- public preflight result is never accepted as authorization;
- backup becomes stale or disappears between public preflight and apply;
- journal or schema changes before acquisition;
- progress persisted only after journal entry;
- final schema, journal, quick check, and terminal audit validation;
- raw errors and internal identifiers redacted;
- no request-controlled SQL or target selection;
- process-local single-flight and no completed cache.

### Failure-injection tests

- failure before table batch;
- failure after table batch but before secondary/journal batch;
- failure after journal but before progress update;
- failure after final verification but before terminal audit;
- process interruption represented by persisted `running` state and expired/stale lease;
- partial future table/index/trigger forces restore-required reconcile;
- journal gap/checksum/future version forces restore-required reconcile;
- fully applied target reconciles successfully;
- no mutation reconciles to interrupted and permits a later fresh apply;
- reconcile never executes migration SQL.

### API and routing tests

- exact paths and methods;
- strict body keys and 4 KiB streaming bound;
- viewer/operator/anonymous rejected before body and D1;
- local same-origin mutation enforced before body and D1;
- service token exact boundary before body and D1;
- status remains read-only;
- schema-pending and maintenance gates route exact recovery paths;
- near-match subpaths rejected;
- fixed status/code mappings, no-store, correlation ID, and safe audit.

### CLI tests

- environment-only secrets;
- exact URL, timeout, redirect, method, headers, and body;
- strict response validation;
- fixed exit codes;
- no raw-body, URL, token, controller-secret, header, SQL, name, checksum, or exception leakage.

### Full regression

- lint;
- production build;
- complete server suite;
- per-file test matrix;
- Auth E2E including Chromium authentication scenarios;
- existing storage status, integrity, preflight, backup, maintenance, schema, health, and recovery tests.

## Documentation

Update:

- storage operations runbook;
- migration preflight runbook;
- maintenance workflow documentation;
- CLI examples and exit codes;
- schema/startup behavior;
- recovery matrix;
- roadmap and issue #44 checkpoint evidence.

The runbook must explicitly state:

- preflight is advisory;
- apply reruns checks under lock;
- maintenance remains active after success;
- terminal audit failure requires reconcile;
- partial or ambiguous application requires restore rather than automatic continuation;
- backup audit proves export generation, not durable external custody;
- no force or bypass path exists.

## Checkpoint completion criteria

The checkpoint is complete when:

1. migration modes and automatic-prefix invariant are enforced;
2. production versions 1–4 bootstrap automatically and no production controlled v5 is added;
3. startup stops before injected/future controlled migrations and returns pending state;
4. controlled apply requires active maintenance, exact confirmation, mandatory start audit, shared lock, and locked preflight;
5. operation progress is durable and bounded;
6. apply cannot execute request-controlled SQL or target selection;
7. interruption and partial application fail closed;
8. reconcile classifies but never applies or repairs SQL;
9. routes and CLIs are strict and redacted;
10. operations documentation is updated;
11. exact-head CI, full server suite, matrix, and Auth E2E are green;
12. the focused PR is reviewed and merged while issue #44 remains open for the Storage Center UI and any later real controlled migration.
