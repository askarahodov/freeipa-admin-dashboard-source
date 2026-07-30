# Canonical Database Migration Lifecycle Design

## Context

The portal currently creates parts of its D1/SQLite schema lazily from request handlers. `db/schema.ts` describes only a subset of the production objects, while authentication, audit, catalog synchronization, approvals, notifications, operation results and settings lifecycle modules own additional `CREATE TABLE`, `CREATE INDEX` and trigger statements.

This prevents reliable schema-version reporting, compatibility checks, backup preflight, deterministic empty-database creation and safe disaster recovery. Issue #57 is therefore a prerequisite for backup and restore management in #37.

## Scope and delivery sequence

Issue #57 is implemented as two isolated pull requests.

1. **Migration foundation:** canonical baseline inventory, migration journal, adoption of existing runtime-created databases, checksum validation, drift detection, startup/readiness boundary and safe diagnostics.
2. **DDL ownership cleanup:** replace lazy runtime DDL with schema-ready assertions, remove duplicated schema definitions from domain modules, and prove that only canonical migrations may change schema.

The first pull request produces working, testable software and does not claim to close #57. It establishes the safety boundary needed for the cleanup pull request.

## Goals

- Define one canonical inventory for every current production table, index and trigger.
- Create an empty database exclusively from a versioned migration.
- Adopt an existing database whose objects were created by current runtime handlers without losing data.
- Record migration version, immutable checksum, application timestamp and execution duration.
- Reject checksum mismatch, unsupported future versions and incompatible structural drift before serving normal traffic.
- Diagnose compatible extra objects without deleting or rewriting them.
- Serialize concurrent startup migration attempts.
- Expose safe migration status through the existing admin diagnostics response and a service-admin recovery endpoint.
- Keep `CONFIG_ENCRYPTION_KEY`, encrypted values, SQL bodies and credentials out of diagnostics and audit metadata.

## Non-goals for the first pull request

- Destructive or data-rewriting migrations.
- Backup/export/import/restore implementation from #37.
- Storage-center UI from #44.
- Removal of every legacy DDL statement; that is the immediately following #57 cleanup pull request.
- Automatic repair of a journaled database that later develops drift.

## Threat model

### Protected assets

- Local users, password hashes and salts.
- Session token hashes and session metadata.
- Encrypted integration settings, revision snapshots, approval and replay specifications.
- Operation history, result metadata, catalog metadata and append-only audit events.
- Migration history and compatibility evidence used by future restore workflows.

### Threats

- A partially applied migration being reported as successful.
- Two worker instances applying the same migration concurrently.
- Modified migration SQL retaining the same version number.
- A newer database being opened by older application code.
- Missing or altered columns/indexes/triggers being silently recreated or ignored after adoption.
- Diagnostics exposing SQL, encrypted payloads, keys or credentials.
- A test double being mistaken for a production D1 binding and breaking unit tests.

### Controls

- SHA-256 checksum per migration.
- D1 lock table with owner token, expiry and bounded retry.
- Idempotent baseline DDL followed by structural verification before journal insertion.
- Journal insertion only after verification succeeds.
- Post-journal validation on every new worker isolate before normal request dispatch.
- Explicit `compatibleDrift` and `incompatibleDrift` lists containing object identifiers only.
- Production capability check requires the D1 `batch` function; lightweight unit-test doubles continue to delegate without migration execution.
- No destructive SQL in automatic migrations.

## Canonical schema model

`db/portal-schema.ts` owns immutable descriptions of:

- tables and required columns;
- named indexes;
- append-only audit triggers;
- baseline SQL statement order;
- ignored platform objects such as SQLite and Cloudflare internal tables.

The baseline includes the current runtime objects:

- `app_settings`;
- `operation_runs`;
- `xyops_catalog_snapshot`, `xyops_catalog_history`, `xyops_catalog_sync_lock`, `xyops_catalog_sync_runs`;
- `operation_run_replays`, `operation_run_results`;
- `operation_notifications`, `operation_notification_reads`;
- `catalog_visibility_policies`;
- `approval_policy_sets`, `operation_approvals`, `operation_approval_decisions`;
- `process_presentation_sets`;
- `portal_users`, `portal_sessions`;
- `portal_audit_events` and its append-only triggers;
- `portal_settings_drafts`, `portal_settings_apply_commits`, `portal_settings_revisions`, `portal_settings_draft_resets`, `portal_settings_source_lock`;
- migration-owned `portal_schema_migrations` and `portal_schema_lock`.

The inventory contract test extracts runtime `CREATE TABLE IF NOT EXISTS` statements from source files and fails when a table is absent from the canonical inventory. This catches schema owners that manual review misses.

## Migration journal and locking

`portal_schema_migrations` contains:

- `version INTEGER PRIMARY KEY`;
- `name TEXT NOT NULL`;
- `checksum TEXT NOT NULL`;
- `applied_at INTEGER NOT NULL`;
- `execution_ms INTEGER NOT NULL`.

`portal_schema_lock` contains one row named `main`, an unguessable owner token and acquisition time. A stale lock expires after 60 seconds. Contenders retry for a bounded period and then return `schema_migration_busy` rather than serving traffic against an uncertain schema.

## Baseline adoption flow

1. Create only the journal and lock infrastructure.
2. Acquire the migration lock.
3. Read applied journal rows.
4. Reject versions above the application latest version.
5. Reject checksum mismatches for already applied versions.
6. For an unapplied baseline, execute the idempotent canonical DDL batch.
7. Inspect tables, columns, indexes and triggers.
8. If incompatible drift exists, do not insert the journal row and return a safe failure.
9. Insert the baseline journal row with its checksum.
10. Re-read and validate the final status.
11. Release the lock best-effort.

Existing rows are never updated or deleted by baseline adoption.

## Drift classification

### Incompatible drift

Blocks readiness:

- missing required table, column, index or trigger;
- required column type, `NOT NULL` or primary-key mismatch;
- applied migration checksum mismatch;
- journal version newer than the application;
- failed migration execution or verification.

### Compatible drift

Reported but does not block readiness:

- additional application table not owned by the canonical schema;
- additional column or index on a known table;
- platform-internal objects are ignored.

Compatible drift is never removed automatically.

## Runtime boundary

`worker/schema-migrations-entry.ts` becomes the outer Vite worker entry and delegates to `service-admin-root-entry.ts` only after `ensurePortalSchema()` reports `ready`.

- Normal fetch and scheduled traffic receive HTTP 503 / skipped execution when schema is unavailable, busy, failed or incompatible.
- The service-admin endpoint `GET /api/schema/status` remains available for recovery diagnostics and requires a valid `ADMIN_TOKEN` using constant-time comparison.
- Lightweight test D1 objects without `batch()` bypass the production migration boundary so existing focused unit tests remain isolated.
- Successful status is cached briefly per D1 object; failures are not permanently cached.

## Diagnostics

The existing admin-only `/api/auth/diagnostics` response gains a `database.schema` section containing only:

- state;
- current and latest version;
- applied and pending migration numbers;
- compatible and incompatible drift object identifiers;
- safe error code;
- last verification timestamp.

The response never contains SQL text, checksums, encrypted values, exception bodies or credentials. The service-admin recovery endpoint may include migration names and checksums because they are code-integrity metadata, but still excludes SQL and database values.

## Error handling

Stable codes:

- `schema_database_unavailable`;
- `schema_migration_busy`;
- `schema_migration_failed`;
- `schema_incompatible_drift`;
- `schema_checksum_mismatch`;
- `schema_future_version`;
- `schema_authorization_required`.

Unexpected exceptions are converted to `schema_migration_failed`; raw exception messages are not returned to clients.

## Testing

Behavior tests cover:

- empty database baseline creation;
- adoption of an existing compatible database without data mutation;
- idempotent repeated startup;
- checksum mismatch;
- future migration version;
- missing column/index/trigger drift;
- compatible extra objects;
- failed migration does not create a journal row;
- concurrent startup lock contention;
- safe status serialization and secret/SQL redaction;
- canonical inventory covers every runtime-created table;
- Vite entry points to the migration boundary;
- existing unit-test D1 doubles continue to bypass production migration execution.

CI must pass lint, production build, the full server test matrix and Auth E2E.

## Rollout and rollback

The migration is forward-only and additive. Deployment creates missing objects and adopts compatible existing objects. If the application reports incompatible drift, operators restore the previous application version without any automatic data rewrite. Because the baseline performs no destructive or column-altering statements, rollback of application code does not require a database rollback.

Before later destructive migrations, #37 must provide a verified pre-migration backup and recovery point.

## Follow-up pull request

After the foundation is merged:

- replace domain `ensure*Table` DDL with schema-ready assumptions;
- remove duplicate DDL constants;
- make the source scan reject all schema-changing SQL outside `db/portal-schema.ts` and `db/portal-migrations.ts`;
- expand historical adoption fixtures;
- close #57 only after request handlers no longer own schema and the complete migration matrix passes.
