# Read-only Storage Status Design

## Scope

This is the first isolated checkpoint of #44. It adds a read-only administrative storage inspection contract and a CLI client for cases where the browser UI is unavailable. It does **not** execute migrations, integrity repair, cleanup, restore, DDL, DML, arbitrary SQL, or filesystem discovery.

## API contract

`GET /api/admin/storage/status` returns contract version `1` with `Cache-Control: no-store`.

Access is limited to the existing effective `admin` role. Local administrator sessions use the existing identity/RBAC pipeline. The existing service administrator token may access the route through the same explicit path allowlist used by backup and maintenance administration. Viewer, operator, anonymous, and invalid service-token requests are denied without evaluating storage queries.

The response contains only bounded, sanitized metadata:

- overall state: `healthy`, `degraded`, or `unavailable`;
- database availability and best-effort logical size from read-only SQLite pragmas;
- canonical schema state, current/latest version, applied/pending versions, drift counts, and a safe schema error code;
- fixed domain aggregates with expected/present table counts and total record counts;
- AES-GCM configuration self-test state without key, hash, ciphertext, or fragments;
- last successful backup export and production restore timestamps derived from append-only audit metadata;
- cleanup timestamp as `null` until #42 provides the lifecycle contract;
- generation timestamp and a correlation ID.

The API never returns database paths, SQL text, table names, row contents, usernames, session values, integration configuration, raw exceptions, or raw schema drift identifiers.

## Runtime routing

The exact storage path is delegated through schema and maintenance recovery gates before those gates inspect a possibly broken database. This does not authorize the request.

`worker/local-secure-entry.ts` remains directly composed with the established settings runtime. It resolves a local session or validates the explicit service-administrator token first, constructs the existing delegated static identity, and only then invokes the storage handler. Viewer/operator sessions reach the handler with their real delegated role and receive `403` before database inspection.

This placement preserves the existing settings source contracts, scheduled delegation, service-admin explicit-path model, and Docker health policy. There is no storage-specific authorization shortcut and no wildcard admin route.

## Query bounds

The inspector imports the canonical table registry and assigns every table to one fixed domain:

- `settings`;
- `operations`;
- `catalog`;
- `approvals`;
- `identity`;
- `audit`;
- `maintenance`;
- `restore`;
- `other`.

It reads `sqlite_master` once, counts only present canonical tables, and executes at most one `COUNT(*)` query per canonical table. Table identifiers are never accepted from request input. Size inspection uses only `PRAGMA page_count` and `PRAGMA page_size`; unsupported pragmas produce `null` values and a safe code rather than failing the endpoint.

Schema inspection calls `inspectPortalSchema` from the hardened canonical migration layer. It must never call `ensurePortalSchema`, so inspection cannot apply migrations.

Lifecycle aggregation distinguishes successful backup export actions (`backup.%export%.completed`) from successful production restore actions (`backup.restore.%`). Restore commits therefore do not overwrite the last-backup timestamp.

## State calculation

- `unavailable`: no migration-capable database or the initial database inventory cannot be read;
- `degraded`: schema is not `ready`, encryption self-test fails, a canonical count fails, or optional size/lifecycle metadata is unavailable;
- `healthy`: database, schema, encryption, all bounded counts, and supported metadata checks succeed.

A partial failure returns HTTP `200` with `degraded` state and fixed safe codes. A database-unavailable condition returns HTTP `503` with the same versioned response shape.

## Audit

Every authorized inspection attempts to append one event:

- action: `storage.inspect`;
- resource type: `portal-storage`;
- outcome: `success` for healthy/degraded responses, `failure` for unavailable/exception responses;
- metadata: overall state, schema version, domain count, duration, and safe codes only.

Audit failure never leaks details and does not replace the storage response.

## CLI

`npm run inspect:storage` is an HTTP CLI client for a running portal whose UI may be broken. It uses the same API contract rather than a second database implementation.

Configuration:

- `PORTAL_URL` or `--url` selects the portal origin;
- `ADMIN_TOKEN` is read only from the environment and sent as `x-admin-token`;
- `--timeout-ms` is bounded between 500 and 30000 milliseconds;
- output is the exact sanitized JSON response;
- token values, request headers, redirects, and raw response bodies from invalid content types are never printed.

The token is intentionally not accepted as a command-line argument to avoid process-list exposure.

## Failure and rollback semantics

The checkpoint adds no schema objects and has no data migration. Rollback is removal of the route, inspector module, CLI, and documentation. Existing health, schema, backup, maintenance, and Docker contracts remain unchanged.

## Testing

Behavior tests cover:

- healthy and degraded aggregation;
- database unavailable;
- pending/failed/drift schema states;
- unsupported size pragmas;
- bounded canonical table counting and absence of request-controlled SQL;
- separation of backup-export and production-restore audit families;
- secret/raw error redaction;
- admin/service-admin access and viewer/operator denial before queries;
- audit metadata bounds;
- route ordering before ordinary schema gates without bypassing authorization;
- preservation of the existing settings/local-session composition;
- CLI URL/timeout parsing, environment-only token handling, non-JSON failures, and exit codes;
- unchanged `/health/live`, `/health/ready`, and Docker healthcheck behavior.
