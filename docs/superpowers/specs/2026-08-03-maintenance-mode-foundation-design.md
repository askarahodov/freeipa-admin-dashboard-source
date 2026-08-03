# Maintenance Mode Foundation Design

## Context

Issue #37 still requires destructive full restore and offline recovery after selective restore landed in PR #70. The portal runs Wrangler with persistent local D1 state under the Docker volume mounted at `/app/.wrangler`. A future offline restore must be able to stop normal portal traffic, preserve that stop across process restarts, revoke local sessions, and resume only after explicit verification.

This PR provides that online safety boundary only. It does not replace SQLite files, decrypt a backup, run an offline restore, or claim that recovery verification succeeded.

## Goals

- Persist maintenance state in canonical D1 schema migration v3.
- Require administrator RBAC and same-origin mutation checks for every control operation.
- Use one random client-held controller secret per maintenance operation; persist only its SHA-256 hash.
- Block every non-recovery API while maintenance is not inactive, including service-admin-token requests.
- Keep static application assets available so operators can see maintenance status.
- Revoke all local portal sessions when maintenance becomes active.
- Persist maintenance through Worker and container restarts until an explicit verified exit sequence completes.
- Emit aggregate audit events without controller secrets, hashes, confirmation strings, cookies, or database contents.
- Suppress scheduled jobs while maintenance is active.

## Non-goals

- Offline SQLite discovery, backup, rebuild, file swap, rollback, or `fsync`.
- Destructive full restore API.
- Automatic exit from maintenance after a timeout or process restart.
- Server-side persistence of backup documents or backup passwords.
- Restoring historical sessions.
- UI wizard for destructive restore.

## State model

The public state is one of:

- `inactive` — no maintenance operation is controlling the portal;
- `entering` — an administrator prepared maintenance and received the controller secret;
- `active` — normal API traffic and scheduled work are blocked; local sessions were revoked;
- `verifying` — an offline recovery tool has started post-restore verification;
- `exiting` — verification was accepted and the operator is performing final health checks before reopening;
- `failed` — the operation cannot safely continue automatically and the portal remains blocked.

A singleton row with id `main` is stored in `portal_maintenance_state`. Absence of the row is interpreted as `inactive`; the first prepare operation creates it atomically. The row contains only operation metadata:

- `state`;
- opaque `operation_id`;
- actor identity and sanitized group JSON;
- SHA-256 controller-secret hash;
- creation, update, prepare-expiry and completion timestamps;
- a fixed safe failure code;
- aggregate verification JSON.

No password, controller secret, backup payload, encryption key, token, cookie, SQL body, filesystem path, or raw exception is stored.

## Control API

All mutation endpoints require an administrator role and a same-origin `Origin` header. Service-admin access continues to use the existing `x-admin-token` boundary, but the global maintenance gate is outside that boundary and cannot be bypassed by the token.

### `GET /api/admin/maintenance/status`

Returns the administrator-safe state projection. It may include the operation id, timestamps, state, whether recovery is required, and bounded aggregate verification fields. It never returns actor groups, controller-secret hash, or failure internals.

### `GET /api/maintenance/status`

Returns a public safe projection containing only `maintenance`, `state`, `updatedAt`, and `recoveryRequired`. It is available during maintenance without authentication.

### `POST /api/admin/maintenance/prepare`

Valid only from `inactive`. Atomically creates an `entering` operation with a 15-minute prepare expiry and returns:

- `operationId`;
- the controller secret exactly once;
- `expiresAt`;
- the exact confirmation string `ENTER:<operationId>`.

Concurrent prepare requests fail closed with `maintenance_operation_conflict`.

### `POST /api/admin/maintenance/enter`

Requires the operation id, controller secret, and exact confirmation string. It atomically changes `entering` to `active`, clears prepare expiry, and deletes every row from `portal_sessions` in the same D1 batch. An expired prepare cannot enter maintenance.

### `POST /api/admin/maintenance/verification/start`

Requires the active operation, controller secret, and exact `VERIFY:<operationId>` confirmation. It changes `active` to `verifying`. It does not claim any check passed.

### `POST /api/admin/maintenance/exit`

Requires `verifying`, the controller secret, exact `EXIT:<operationId>`, and a strict aggregate verification object with all required checks equal to `ok`:

- `integrity`;
- `schema`;
- `administratorAccess`;
- `settingsDecryption`;
- `auditWrite`.

It changes `verifying` to `exiting` and stores only this bounded aggregate object.

### `POST /api/admin/maintenance/complete`

Requires `exiting`, the controller secret, and exact `RESUME:<operationId>`. It changes the singleton row to `inactive`, clears the secret hash and operation metadata, and records completion through audit.

### `POST /api/admin/maintenance/cancel`

Valid only while `entering`, before expiry. It requires the controller secret and exact `CANCEL:<operationId>` confirmation, then returns to `inactive`. Active, verifying, exiting, or failed operations cannot be cancelled through this endpoint.

## Global request gate

`worker/maintenance-mode-root-entry.ts` is placed between the schema-migration boundary and `service-admin-root-entry.ts`.

After schema readiness is confirmed, the gate reads the singleton maintenance row before delegating requests. When state is not `inactive`:

- non-API static assets continue to load;
- `/api/maintenance/status`, `/api/admin/maintenance/*`, `/api/integrations/health`, and `/api/schema/status` are allowed;
- every other `/api/` request returns HTTP 503 with `portal_maintenance_active`, `Retry-After: 60`, and `Cache-Control: no-store`;
- service-admin-token requests receive the same block;
- scheduled handlers do not run.

If maintenance state cannot be read, the gate fails closed for API traffic with `maintenance_state_unavailable`; public status and health remain available with a safe unavailable state.

The existing integration health response receives `x-portal-maintenance-state` and `cache-control: no-store` headers but is not rewritten or expanded with sensitive data.

## Schema migration v3

Migration v3 creates:

- `portal_maintenance_state` singleton table;
- `portal_maintenance_state_state_idx` over `state, updated_at`.

The migration registry becomes `[1, 2, 3]`. The v3 verifier checks exact columns, types, nullability, primary key, index definition, and rejects unexpected triggers, indexes, foreign keys, checks, and unique constraints. Registry-aware coalescing remains enabled so concurrent first requests do not receive transient schema-lock failures.

## Security properties

- Controller secrets are generated from 32 random bytes and encoded as unpadded base64url.
- Secret comparison hashes the supplied value and compares fixed-size bytes in constant time.
- Confirmation strings are derived from server-issued operation ids and compared exactly.
- Operation ids use `maintenance_<uuid>` and are not credentials.
- Only the `enter` transition can revoke sessions; session deletion and state transition are one D1 batch.
- No transition silently reopens the portal after a restart or timeout.
- Unknown states, malformed rows, multiple active rows, and repository errors fail closed.
- Error responses use a fixed allowlist and never include raw D1 errors.
- Audit metadata is aggregate only: transition, state, operation id, timestamps, and verification check names.

## Testing

The PR must include:

- state-machine, secret, confirmation, and projection unit tests;
- repository atomicity and concurrent-prepare tests;
- migration v3 and schema-drift tests;
- admin RBAC, same-origin, service-admin and direct-API tests;
- global gate tests proving normal APIs and scheduled work are blocked;
- session-revocation tests proving state activation and deletion share one batch;
- restart persistence tests using a fresh handler over the same fake D1 state;
- source-contract tests banning secret logging, raw errors, backup decryption, filesystem access, and restore DML outside the maintenance allowlist;
- full lint, production build, complete server suite, and Auth E2E on the final PR head.

## Follow-up PR #72

The offline recovery CLI will consume this state machine. It will require the dashboard container to be stopped for SQLite replacement, create an external encrypted pre-restore recovery point, rebuild a temporary canonical database, verify it, perform an atomic file swap, restart in maintenance, run smoke checks, submit the aggregate verification object, and only then complete maintenance.