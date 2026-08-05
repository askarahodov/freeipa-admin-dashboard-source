# Read-only storage status

## Purpose

The first Storage Center checkpoint exposes bounded, sanitized, read-only metadata for the local D1/SQLite storage used by FreeIPA Admin Dashboard.

It is designed for operational diagnosis when the ordinary UI, canonical schema, or maintenance state is unavailable. It does not apply migrations or repair data.

## API

```http
GET /api/admin/storage/status
```

The route is available through the existing administrator boundaries:

- an authenticated local portal session whose effective role is `admin`;
- the explicit service-administrator `x-admin-token` boundary.

Anonymous requests receive `401` in local identity mode. Viewer and operator sessions receive `403` before storage inspection starts.

Responses use contract version `1`, `Cache-Control: no-store`, and an `x-correlation-id` header.

### HTTP status

| Status | Meaning |
| --- | --- |
| `200` | Inspection completed. The body state is `healthy` or `degraded`. |
| `403` | The authenticated principal is not an administrator. |
| `405` | Only `GET` is supported. |
| `503` | The database inventory cannot be read or inspection failed before a bounded report could be produced. |

`degraded` remains HTTP `200` because the result is a successful diagnostic response. Typical degraded causes include pending/incompatible schema state, unsupported size pragmas, a failed encryption self-test, a missing canonical table, a failed bounded count, or unavailable lifecycle metadata.

## Response fields

The response contains:

- overall state: `healthy`, `degraded`, or `unavailable`;
- database availability and best-effort logical byte size derived from `page_count × page_size`;
- canonical schema state, current/latest versions, applied/pending versions, drift counts, and a fixed safe error code;
- fixed domain aggregates for expected/present table counts and total records;
- AES-GCM configuration self-test state;
- last successful backup export and production restore timestamps when matching audit events exist;
- `lastCleanupAt: null` until retention checkpoint #42 defines that lifecycle;
- generation timestamp and correlation ID.

The response never includes:

- database paths or SQLite files;
- SQL text;
- table names or row contents;
- usernames or session values;
- integration settings;
- encryption key, key hash, ciphertext, or fragments;
- raw migration drift identifiers;
- raw exceptions or upstream response bodies.

## Query bounds

The inspector reads `sqlite_master` once and intersects the result with the compile-time canonical schema registry. It then issues at most one `COUNT(*)` per present canonical table.

Request data cannot supply a table name, pragma, filter, or SQL fragment. The service contains no DDL or data-changing statements and calls `inspectPortalSchema`, never `ensurePortalSchema`.

`PRAGMA page_count` and `PRAGMA page_size` are best effort. Unsupported pragmas degrade only the size component.

## Audit

An authorized inspection attempts to append a `storage.inspect` event containing only:

- overall state;
- schema version;
- number of fixed domains;
- bounded duration;
- fixed storage component codes.

Audit persistence failure does not replace the diagnostic response and does not expose the audit error.

## CLI

The CLI consumes the same HTTP contract and is suitable when the browser UI cannot be used:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='read-from-a-secret-provider' \
npm run inspect:storage
```

Optional arguments:

```text
--url URL
--timeout-ms 500..30000
```

The token is accepted only from `ADMIN_TOKEN`; passing tokens, headers, passwords, cookies, or authorization values on the command line is rejected to avoid process-list exposure.

Default values:

- `PORTAL_URL`: `http://127.0.0.1:3001`;
- timeout: `5000` ms.

The URL must be an HTTP(S) origin without embedded credentials, path, query, or fragment. Redirects are not followed.

### CLI exit codes

| Code | Meaning |
| --- | --- |
| `0` | Valid `healthy` or `degraded` report. |
| `2` | Valid `unavailable` report or server-side failure. |
| `3` | Authentication or authorization failed. |
| `4` | Timeout or network failure. |
| `5` | Invalid arguments, URL, redirect, content type, or response contract. |

Valid reports are printed as formatted JSON. Failures print only a fixed machine-readable code; raw response bodies, locations, exception messages, target URLs, and tokens are not printed.

## Recovery and rollback

This checkpoint adds no database schema objects and performs no data migration. Rollback consists of removing the route, inspector, CLI, and documentation.

Do not use this endpoint or CLI to:

- trigger container restarts;
- run migrations;
- execute integrity repair;
- perform cleanup;
- restore a backup;
- inspect arbitrary tables or SQL.

Docker remains bound to `/health/live`; reverse-proxy/orchestrator readiness remains `/health/ready`.
