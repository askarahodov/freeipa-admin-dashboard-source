# Read-only Storage Integrity and Index Diagnostics Design

## Context

Issue #44 requires storage health and migration management. The first checkpoint added bounded `GET /api/admin/storage/status` and an HTTP CLI without mutation. This second checkpoint adds an explicit, more expensive read-only integrity operation while keeping migration preflight/apply, repair, retention, and UI out of scope.

## Goals

- Add an admin-only explicit integrity check that is available through existing schema and maintenance recovery gates.
- Run one bounded SQLite quick check and one canonical index inventory.
- Return only fixed states, fixed codes, counts, timestamps, duration, and correlation ID.
- Reuse the existing local-session and explicit service-admin authorization boundaries.
- Add a browser-independent CLI consuming the same HTTP contract.
- Preserve all existing health, storage-status, settings, authentication, maintenance, and Docker contracts.

## Non-goals

- No DDL or DML.
- No migration preflight, lock acquisition, migration apply, repair, `REINDEX`, `VACUUM`, `ANALYZE`, or `PRAGMA optimize`.
- No arbitrary SQL, table/index parameters, raw SQLite output, object names, definitions, or database paths.
- No readiness/liveness integration and no Storage Center UI.

## API

`POST /api/admin/storage/integrity/check`

The request body is not used. Query parameters do not influence SQL. The exact path is added to the existing explicit service-admin and recovery allowlists. Local browser requests still pass through the existing session resolver and same-origin mutation policy before the integrity handler.

HTTP semantics:

- `200`: evaluation completed; body state is `healthy` or `degraded`.
- `401`: existing anonymous local-mode behavior.
- `403`: authenticated principal is not an administrator or mutation origin policy rejects the request.
- `405`: method is not `POST`.
- `503`: database binding or bounded evaluation is unavailable.

All responses use `Cache-Control: no-store`. Successful evaluation responses include `x-correlation-id` and the same correlation ID in the body.

## Response contract

Contract version is `1`.

```json
{
  "contractVersion": "1",
  "generatedAt": 1754400000000,
  "durationMs": 42,
  "state": "healthy",
  "quickCheck": {
    "state": "healthy",
    "code": "storage_quick_check_ok"
  },
  "indexes": {
    "expected": 19,
    "present": 19,
    "missing": 0,
    "mismatched": 0,
    "unexpected": 0,
    "code": "storage_indexes_ready"
  },
  "correlationId": "cor_..."
}
```

Overall state values are `healthy`, `degraded`, and `unavailable`.

Quick-check component states and codes:

- `healthy` / `storage_quick_check_ok`
- `failed` / `storage_quick_check_failed`
- `unsupported` / `storage_quick_check_unsupported`
- `unavailable` / `storage_quick_check_unavailable`

Index component codes:

- `storage_indexes_ready`
- `storage_indexes_degraded`
- `storage_indexes_unavailable`

The response never includes quick-check result text, index names, table names, SQL definitions, row data, database paths, raw exceptions, credentials, tokens, or internal URLs.

## Integrity service

A focused `storage-integrity.ts` service owns evaluation over an injected query adapter.

### Quick check

The service executes exactly one fixed statement:

```sql
PRAGMA quick_check(1)
```

A single returned value equal to `ok` (case-insensitive, surrounding whitespace ignored) is healthy. Any other returned value is failed and discarded. Errors classified by a narrow allowlist of feature-not-supported indicators become `unsupported`; all other errors become `unavailable`. Raw error text never leaves the classifier.

### Canonical index inventory

The service imports the compile-time `portalSchemaIndexes` registry. It executes one fixed query against `sqlite_schema` for `type = 'index'`, excluding auto-indexes. The query returns name, table name, and SQL internally.

For each canonical index:

- missing name increments `missing`;
- a present index whose normalized table or definition does not match the compile-time definition increments `mismatched`;
- an extra explicitly-created index whose name starts with a fixed portal-owned prefix derived from canonical index families increments `unexpected`.

Only counts are returned. Counts are safe non-negative integers capped at 10,000. Definitions are normalized internally by collapsing whitespace, removing `IF NOT EXISTS`, and comparing case-insensitively. Request data cannot supply identifiers or SQL.

## Bounds and concurrency

Each evaluation executes at most:

- one `PRAGMA quick_check(1)`;
- one `sqlite_schema` index inventory query.

A process-local single-flight wrapper coalesces overlapping checks. The in-flight result is not retained after completion and no diagnostic payload is cached. Duration is capped at 60,000 ms in public/audit metadata.

## Authorization and routing

- Viewer and operator principals are rejected before the service is called.
- Local admin requests are resolved by the existing local session flow.
- Service-admin requests require the existing constant-time token check on the exact path.
- The path is allowed through schema and maintenance recovery gates, but those allowlists do not bypass authentication or role checks.
- Same-origin mutation enforcement remains in the existing local secure boundary.

## Audit

Authorized checks append best-effort action `storage.integrity.check` on resource type `portal-storage`.

Audit metadata contains only:

- overall state;
- bounded duration;
- fixed quick-check/index codes;
- expected/present/missing/mismatched/unexpected counts.

Audit failure never replaces the diagnostic response.

## CLI

Add `npm run inspect:storage-integrity`.

The CLI sends `POST` to the exact integrity path and consumes the same contract. It accepts:

- base origin from `PORTAL_URL` or `--url`;
- token only from `ADMIN_TOKEN`;
- timeout from `--timeout-ms`, bounded to 500..30000 ms.

It rejects token/header/password/cookie/auth CLI arguments, embedded URL credentials, path/query/fragment input, redirects, non-JSON content, and invalid contracts. It never prints raw body, redirect location, exception text, URL, or token.

Exit codes:

- `0`: valid `healthy` or `degraded` report;
- `2`: valid `unavailable` report or server-side failure;
- `3`: authentication/authorization failure;
- `4`: timeout/network failure;
- `5`: arguments, URL, redirect, protocol, content type, or contract failure.

## Testing

TDD coverage must include:

- healthy quick check and exact canonical index set;
- failed and unsupported quick check without raw result/error leakage;
- missing, mismatched, and unexpected index counts;
- database/inventory failure mapping;
- fixed two-query bound;
- single-flight coalescing;
- admin success and bounded audit;
- viewer/operator denial before evaluation;
- GET/PUT/DELETE method rejection;
- runtime placement after session/origin resolution and explicit service-admin path authorization;
- CLI POST behavior, exit codes, redaction, timeout, redirects, and contract validation;
- unchanged `/health/live`, `/health/ready`, `/health/dependencies`, Docker HEALTHCHECK, and existing storage status.

## Rollback

This checkpoint creates no schema objects and writes no application data except the existing append-only audit event. Rollback removes the route, service, CLI, tests, and documentation. No database rollback is required.
