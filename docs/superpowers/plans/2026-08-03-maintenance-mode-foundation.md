# Maintenance Mode Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, administrator-controlled maintenance mode that blocks portal API traffic and scheduled work until an explicit verified exit sequence completes.

**Architecture:** Add canonical migration v3 for a singleton maintenance-state table, a focused repository/state-machine layer, administrator-only control endpoints below the existing service-admin boundary, and a global request gate above that boundary. Controller secrets remain client-held; only SHA-256 hashes and aggregate state metadata are stored.

**Tech Stack:** TypeScript, Cloudflare Worker/D1 APIs, Web Crypto, Node 22.13 test runner, Vite/Vinext/Wrangler, GitHub Actions.

## Global Constraints

- Branch from `main` commit `e9ddd06120eeb7097a37f200a43e9bd324934d84`.
- Node.js floor remains `>=22.13.0`; add no dependencies.
- `CONFIG_ENCRYPTION_KEY`, backup passwords, controller secrets, hashes, cookies, sessions and raw D1 errors must never appear in responses, audit metadata, logs or CI artifacts.
- All maintenance mutations are administrator-only and require same-origin validation.
- Service-admin tokens may authorize control endpoints but may not bypass the active maintenance gate.
- Non-inactive maintenance state persists across Worker/container restarts and never expires back to inactive automatically.
- Static assets remain available; non-allowlisted `/api/` requests return 503 while maintenance is non-inactive.
- Session deletion and transition to `active` occur in one D1 batch.
- No backup decryption, filesystem access, SQLite replacement or destructive full restore is implemented in this PR.
- Every production behavior follows RED → GREEN → refactor with focused tests before implementation.

---

### Task 1: Canonical maintenance schema and migration v3

**Files:**
- Create: `db/portal-maintenance-schema.ts`
- Create: `db/portal-migration-v3.ts`
- Create: `db/portal-migrations-v3.ts`
- Modify: `db/portal-migrations-hardened.ts`
- Test: `tests/portal-schema-maintenance.test.mjs`
- Test: `tests/portal-schema-inventory.test.mjs`
- Test: `tests/runtime-schema-ddl-contract.test.mjs`

**Interfaces:**
- Produces `portalMaintenanceStateTable`, `portalMaintenanceStateIndex`.
- Produces `portalMigrationsV3`, `ensurePortalSchemaV3(env, options)`, `inspectPortalSchemaV3(env, options)`.
- Existing public `ensurePortalSchema` and `inspectPortalSchema` continue exporting through `portal-migrations-hardened.ts` but use registry `[1,2,3]`.

- [ ] **Step 1: Write failing schema tests**

Add tests asserting migration v3 creates exactly:

```js
[
  "id", "state", "operation_id", "actor_identity", "actor_groups_json",
  "controller_secret_hash", "created_at", "updated_at", "expires_at",
  "completed_at", "failure_code", "verification_json",
]
```

Assert the table has primary key `id`, no foreign keys/checks/unexpected unique constraints, and one index named `portal_maintenance_state_state_idx` over `state, updated_at`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/portal-schema-maintenance.test.mjs tests/portal-schema-inventory.test.mjs tests/runtime-schema-ddl-contract.test.mjs
```

Expected: FAIL because migration v3 exports and schema objects do not exist.

- [ ] **Step 3: Implement migration v3**

Define a singleton-compatible table without DDL constraints beyond the primary key:

```ts
export const portalMaintenanceStateTable = {
  name: "portal_maintenance_state",
  sql: `CREATE TABLE IF NOT EXISTS portal_maintenance_state (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    operation_id TEXT,
    actor_identity TEXT,
    actor_groups_json TEXT NOT NULL,
    controller_secret_hash TEXT,
    created_at INTEGER,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER,
    completed_at INTEGER,
    failure_code TEXT,
    verification_json TEXT NOT NULL
  )`,
  columns: [/* exact metadata matching the SQL */],
} as const;
```

Create `portal_maintenance_state_state_idx` on `(state, updated_at)`. Extend the v2 registry with version 3 named `maintenance-mode-foundation`, preserve registry-aware coalescing, and verify exact v3 structure with normalized SQLite DDL.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/portal-maintenance-schema.ts db/portal-migration-v3.ts db/portal-migrations-v3.ts db/portal-migrations-hardened.ts tests/portal-schema-maintenance.test.mjs tests/portal-schema-inventory.test.mjs tests/runtime-schema-ddl-contract.test.mjs
git commit -m "feat: add maintenance schema migration"
```

### Task 2: Pure maintenance state, secret and projection contract

**Files:**
- Create: `maintenance-mode.ts`
- Test: `tests/maintenance-mode.test.mjs`

**Interfaces:**
- Produces `MaintenanceState`, `MaintenanceRow`, `MaintenanceVerification`.
- Produces `createMaintenanceOperationId()`, `createMaintenanceControllerSecret()`, `hashMaintenanceControllerSecret(secret)`, `verifyMaintenanceControllerSecret(hash, secret)`.
- Produces `maintenanceConfirmation(action, operationId)`, `validateMaintenanceVerification(value)`, `publicMaintenanceStatus(row)`, `adminMaintenanceStatus(row)`.

- [ ] **Step 1: Write failing pure-contract tests**

Cover:

```js
assert.match(createMaintenanceOperationId(), /^maintenance_[0-9a-f-]{36}$/i);
assert.match(createMaintenanceControllerSecret(), /^[A-Za-z0-9_-]{43}$/);
assert.equal(await verifyMaintenanceControllerSecret(hash, secret), true);
assert.equal(await verifyMaintenanceControllerSecret(hash, `${secret}x`), false);
assert.equal(maintenanceConfirmation("enter", id), `ENTER:${id}`);
```

Assert public projection excludes operation id, actor, groups, secret hash, failure internals and verification details. Assert admin projection excludes all secret-bearing values. Assert verification accepts only the five exact keys with value `ok`.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/maintenance-mode.test.mjs
```

Expected: FAIL because `maintenance-mode.ts` does not exist.

- [ ] **Step 3: Implement minimal pure module**

Use `crypto.getRandomValues(new Uint8Array(32))`, unpadded base64url, SHA-256 and a fixed-size constant-time comparison loop. Normalize unknown/malformed rows to fail-closed `failed` projections; absence maps to `inactive`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add maintenance-mode.ts tests/maintenance-mode.test.mjs
git commit -m "feat: define maintenance state contract"
```

### Task 3: Atomic D1 maintenance repository

**Files:**
- Create: `maintenance-repository.ts`
- Test: `tests/maintenance-repository.test.mjs`

**Interfaces:**
- Consumes the types and crypto helpers from `maintenance-mode.ts`.
- Produces `loadMaintenanceState(db, now?)`.
- Produces `prepareMaintenance(db, actor, options)` returning `{ row, secret }`.
- Produces `enterMaintenance(db, input)`, `startMaintenanceVerification(db, input)`, `exitMaintenance(db, input)`, `completeMaintenance(db, input)`, `cancelMaintenance(db, input)`.
- Produces `MaintenanceRepositoryError` with fixed allowlisted `code` and `status`.

- [ ] **Step 1: Write failing repository tests**

Use an in-memory D1 fake that records prepared SQL and batch boundaries. Cover:

- concurrent prepare: exactly one succeeds;
- prepare stores only a 64-character hex hash, never the returned secret;
- expired `entering` cannot transition to active;
- `enter` executes one batch containing the guarded state update and `DELETE FROM portal_sessions`;
- wrong secret or confirmation performs no batch;
- active/verifying/exiting state survives a fresh repository instance over the same fake DB;
- cancel works only from entering;
- complete clears operation id, actor, hash, verification and returns state to inactive;
- D1 exceptions normalize to `maintenance_state_unavailable` or `maintenance_transition_failed` without raw text.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/maintenance-repository.test.mjs
```

Expected: FAIL because repository functions do not exist.

- [ ] **Step 3: Implement repository with guarded statements**

Prepare must use a single D1 batch equivalent to:

```sql
INSERT OR IGNORE INTO portal_maintenance_state
  (id, state, actor_groups_json, updated_at, verification_json)
VALUES ('main', 'inactive', '[]', ?, '{}');

UPDATE portal_maintenance_state
SET state = 'entering', operation_id = ?, actor_identity = ?, actor_groups_json = ?,
    controller_secret_hash = ?, created_at = ?, updated_at = ?, expires_at = ?,
    completed_at = NULL, failure_code = NULL, verification_json = '{}'
WHERE id = 'main' AND state = 'inactive';
```

Every transition must include `state`, `operation_id`, `controller_secret_hash` and timestamp predicates. Enter uses one batch for state update plus session deletion. Complete changes to `inactive` and clears all operation fields.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add maintenance-repository.ts tests/maintenance-repository.test.mjs
git commit -m "feat: add atomic maintenance repository"
```

### Task 4: Administrator control HTTP API and audit

**Files:**
- Create: `worker/maintenance-control-entry.ts`
- Create: `worker/maintenance-control-dispatch.ts`
- Create: `worker/maintenance-control-root-entry.ts`
- Modify: `worker/service-admin-root-entry.ts`
- Modify: `admin-session-authorization.ts`
- Modify: `portal-permissions.ts`
- Test: `tests/maintenance-control-api.test.mjs`
- Test: `tests/maintenance-rbac.test.mjs`
- Test: `tests/portal-permissions.test.mjs`
- Test: `tests/admin-session-settings.test.mjs`

**Interfaces:**
- Defines paths for status, prepare, enter, verification start, exit, complete and cancel.
- Dispatch uses existing `encryptedBackupAccess()` and `createAuditContext()`.
- Mutations call `sameOriginAdminMutation(request)` before reading JSON or invoking Web Crypto/D1.
- Service-admin root delegates to maintenance-control root after applying the existing static admin environment override.

- [ ] **Step 1: Write failing API/RBAC tests**

Assert:

- viewer/operator receive 403 with required permission `maintenance.manage` before request-body reads or repository calls;
- missing/cross-origin mutation receives 403;
- service-admin token can call control endpoints in local identity mode;
- prepare returns the controller secret once with `cache-control: no-store`;
- status never returns hash, groups, secret or raw errors;
- every mutation accepts only exact allowlisted keys and bounded JSON body size;
- audit actions are `maintenance.prepare`, `maintenance.enter`, `maintenance.verification.start`, `maintenance.exit`, `maintenance.complete`, `maintenance.cancel`;
- audit metadata contains only operation id, from/to states, timestamps and verification check names.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --experimental-strip-types --test tests/maintenance-control-api.test.mjs tests/maintenance-rbac.test.mjs tests/portal-permissions.test.mjs tests/admin-session-settings.test.mjs
```

Expected: FAIL because routes and permission do not exist.

- [ ] **Step 3: Implement API and dispatch**

Add `maintenance.manage` to the permission union/order/metadata/admin role. Add every `/api/admin/maintenance/*` path to `ADMIN_INTEGRATION_PATHS`. Implement strict JSON parsing with a 16 KiB maximum body and fixed error allowlist. Append audit only after safe context creation; never include request bodies or secrets.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/maintenance-control-entry.ts worker/maintenance-control-dispatch.ts worker/maintenance-control-root-entry.ts worker/service-admin-root-entry.ts admin-session-authorization.ts portal-permissions.ts tests/maintenance-control-api.test.mjs tests/maintenance-rbac.test.mjs tests/portal-permissions.test.mjs tests/admin-session-settings.test.mjs
git commit -m "feat: add maintenance control API"
```

### Task 5: Global maintenance request and scheduled-work gate

**Files:**
- Create: `worker/maintenance-mode-root-entry.ts`
- Modify: `worker/schema-migrations-entry.ts`
- Test: `tests/maintenance-gate.test.mjs`
- Test: `tests/maintenance-source-contract.test.mjs`

**Interfaces:**
- `maintenance-mode-root-entry.ts` imports `service-admin-root-entry.ts`.
- `schema-migrations-entry.ts` imports `maintenance-mode-root-entry.ts` instead of service-admin directly.
- Produces `handleMaintenanceGate(request, env, next)` for focused tests.

- [ ] **Step 1: Write failing gate tests**

Cover inactive passthrough, static asset passthrough, and blocked API response:

```js
assert.equal(response.status, 503);
assert.equal(response.headers.get("retry-after"), "60");
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), {
  error: "portal_maintenance_active",
  maintenance: { state: "active", recoveryRequired: true },
});
```

Prove service-admin requests are blocked before the inner runtime. Prove public/admin maintenance status, control endpoints, schema status and integration health are allowlisted. Prove health receives `x-portal-maintenance-state`. Prove scheduled handler is skipped while non-inactive. Prove repository read failures fail closed for API traffic and do not expose raw errors.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --experimental-strip-types --test tests/maintenance-gate.test.mjs tests/maintenance-source-contract.test.mjs
```

Expected: FAIL because the gate does not exist and schema root still imports service-admin directly.

- [ ] **Step 3: Implement outer gate**

Read maintenance state only after schema readiness. Treat unknown/malformed state as `failed`. Allow non-API paths. For health, delegate then clone headers with `x-portal-maintenance-state` and `cache-control: no-store`. Do not run scheduled work in entering/active/verifying/exiting/failed.

Source-contract tests must reject `console.`, filesystem imports, backup decryption imports, `CONFIG_ENCRYPTION_KEY`, raw error interpolation, and mutation of non-maintenance business tables except exact `DELETE FROM portal_sessions`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/maintenance-mode-root-entry.ts worker/schema-migrations-entry.ts tests/maintenance-gate.test.mjs tests/maintenance-source-contract.test.mjs
git commit -m "feat: enforce global maintenance gate"
```

### Task 6: Operational documentation and roadmap status

**Files:**
- Create: `docs/MAINTENANCE_MODE.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-30-portal-backup-restore.md`
- Modify: `docs/PRODUCT_ROADMAP.md`
- Test: `tests/maintenance-docs-contract.test.mjs`

**Interfaces:**
- Documents exact API paths, state transitions, confirmation strings, session revocation, restart behavior, failure recovery and the boundary with future PR #72.

- [ ] **Step 1: Write failing documentation contract**

Assert docs name all states and endpoints, state that controller secrets are returned once, state that active maintenance never times out automatically, and explicitly forbid running offline file replacement while the dashboard process is active.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/maintenance-docs-contract.test.mjs
```

Expected: FAIL because operational docs do not exist.

- [ ] **Step 3: Write docs and update roadmap**

Mark selective production restore complete. Mark maintenance foundation complete only after implementation. Keep destructive full restore, offline CLI, volume recovery and Playwright restore smoke open.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/MAINTENANCE_MODE.md README.md docs/superpowers/plans/2026-07-30-portal-backup-restore.md docs/PRODUCT_ROADMAP.md tests/maintenance-docs-contract.test.mjs
git commit -m "docs: document maintenance operations"
```

### Task 7: Full regression, draft PR and review hardening

**Files:**
- Modify only files required by failures discovered in this task.

**Interfaces:**
- Final head must be unchanged while the complete verification gate runs.

- [ ] **Step 1: Run focused maintenance suite**

```bash
node --experimental-strip-types --test \
  tests/portal-schema-maintenance.test.mjs \
  tests/maintenance-mode.test.mjs \
  tests/maintenance-repository.test.mjs \
  tests/maintenance-control-api.test.mjs \
  tests/maintenance-rbac.test.mjs \
  tests/maintenance-gate.test.mjs \
  tests/maintenance-source-contract.test.mjs \
  tests/maintenance-docs-contract.test.mjs
```

Expected: all pass, zero failures.

- [ ] **Step 2: Run lint, production build and complete server suite**

```bash
npm run lint
npm run build
node --experimental-strip-types --test tests/*.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 3: Open draft PR**

Open `agent/maintenance-mode-foundation` against `main` titled `Add persistent portal maintenance mode`. The body must describe schema v3, state model, API/gate security, session revocation, explicit non-goals, test evidence and relation to issue #37.

- [ ] **Step 4: Verify GitHub Actions**

Require successful `CI` and `Auth E2E` on the exact final head. Inspect every failed job log before changing code. Do not rerun blindly.

- [ ] **Step 5: Review diff and security boundaries**

Check all changed files, PR comments and review threads. Verify no secret-bearing values, raw Wrangler logs, filesystem operations, backup decryption or destructive restore code entered the PR.

- [ ] **Step 6: Mark ready and merge only after fresh evidence**

Once the exact head has green CI/Auth E2E and no unresolved review threads, mark ready for review. Merge only with an explicit user instruction or an already established instruction to continue and integrate completed roadmap tasks; use squash and expected-head-SHA protection.