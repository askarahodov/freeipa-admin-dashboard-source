# Read-only Storage Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only, versioned, read-only storage status API and an HTTP CLI client without applying migrations or exposing database internals.

**Architecture:** A focused `storage-status.ts` service owns bounded metadata collection over an injected query adapter and hardened schema inspector. `worker/storage-status-entry.ts` owns authorization, response status, and audit; a thin root wrapper integrates it into the existing service-admin/local-session chain. `scripts/storage-inspect.ts` consumes the same HTTP contract when the browser UI is unavailable.

**Tech Stack:** TypeScript, Cloudflare D1/SQLite read-only queries, Node.js 22, existing audit/RBAC helpers, Node test runner, GitHub Actions.

## Global Constraints

- No DDL, DML, migration apply, restore, cleanup, integrity repair, or arbitrary SQL.
- Schema inspection must call `inspectPortalSchema`, never `ensurePortalSchema`.
- Request input must never influence table names, pragmas, or SQL fragments.
- API and CLI must not expose DB paths, SQL, table names, rows, credentials, hashes, ciphertext, internal URLs, raw exceptions, or raw drift identifiers.
- Viewer/operator/anonymous denial must happen before database inspection.
- Service-admin token remains explicit-path only; no wildcard administrative bypass.
- Existing health endpoints and Docker HEALTHCHECK remain unchanged.

---

### Task 1: Storage inspection service

**Files:**
- Create: `storage-status.ts`
- Test: `tests/storage-status.test.mjs`
- Modify: `worker/health-contracts.ts`

**Interfaces:**
- Produces `inspectStorageStatus(env, dependencies): Promise<StorageStatusReport>`.
- Produces `portalEncryptionSelfTest(value): Promise<boolean>` as the shared existing AES-GCM self-test.
- Consumes `portalSchemaTables`, maintenance/restore schema tables, and `inspectPortalSchema` through injection.

- [ ] **Step 1: Write failing behavior tests**

Cover healthy aggregation, schema pending/failed/drift, unavailable DB, unsupported size pragmas, fixed domain counts, lifecycle timestamps, secret/raw-error exclusion, and maximum query bounds.

- [ ] **Step 2: Run focused tests and record RED**

Run: `node --experimental-strip-types --test tests/storage-status.test.mjs`

Expected: failure because `storage-status.ts` and exported encryption self-test do not exist.

- [ ] **Step 3: Implement the minimal service**

Define fixed response types, D1 query adapter, canonical domain classifier, safe number/version/code helpers, bounded table inventory/counts, read-only page pragmas, lifecycle audit timestamps, and state calculation. Catch every optional query independently and return fixed safe codes.

- [ ] **Step 4: Run focused tests to GREEN**

Run: `node --experimental-strip-types --test tests/storage-status.test.mjs`

Expected: all storage service scenarios pass.

- [ ] **Step 5: Commit**

Commit message: `feat: add read-only storage status service`

### Task 2: Admin API, authorization, and audit

**Files:**
- Create: `worker/storage-status-entry.ts`
- Test: `tests/storage-status-api.test.mjs`

**Interfaces:**
- Produces `handleStorageStatusRequest(request, env, dependencies): Promise<Response | null>`.
- Consumes `encryptedBackupAccess`, `createAuditContext`, `appendAuditEvent`, and `inspectStorageStatus`.

- [ ] **Step 1: Write failing API tests**

Cover unrelated routes, GET-only handling, viewer/operator denial before inspector invocation, admin success, database-unavailable HTTP 503, degraded HTTP 200, correlation ID, no-store headers, and bounded audit events.

- [ ] **Step 2: Run focused tests and record RED**

Run: `node --experimental-strip-types --test tests/storage-status-api.test.mjs`

Expected: failure because the route handler does not exist.

- [ ] **Step 3: Implement the route handler**

Use the existing role resolver, reject non-admin before inspection, create one audit context, invoke the service, map unavailable to 503, keep degraded at 200, and append sanitized audit events best-effort.

- [ ] **Step 4: Run focused tests to GREEN**

Run: `node --experimental-strip-types --test tests/storage-status-api.test.mjs`

Expected: all API behavior scenarios pass.

- [ ] **Step 5: Commit**

Commit message: `feat: expose admin storage status API`

### Task 3: Runtime routing and service-admin boundary

**Files:**
- Create: `worker/storage-status-root-entry.ts`
- Modify: `worker/service-admin-root-entry.ts`
- Modify: `admin-session-authorization.ts`
- Test: `tests/storage-status-routing-contract.test.mjs`

**Interfaces:**
- `storage-status-root-entry.ts` delegates all non-storage requests and scheduled events unchanged.
- Service-admin transformation applies only to `/api/admin/storage/status` through `isAdminIntegrationPath`.

- [ ] **Step 1: Write failing routing/source contracts**

Assert the new root wrapper is in the service-admin chain, the path is explicitly allowlisted, storage authorization remains in the handler, scheduled delegation is unchanged, and schema/health/Docker contracts are not modified.

- [ ] **Step 2: Run focused tests and record RED**

Run: `node --experimental-strip-types --test tests/storage-status-routing-contract.test.mjs`

Expected: failure because routing is absent.

- [ ] **Step 3: Add the thin root wrapper and explicit path**

Change only the import edge from `service-admin-root-entry.ts` to the new wrapper and add the exact path to `ADMIN_INTEGRATION_PATHS`.

- [ ] **Step 4: Run focused and existing authorization tests**

Run: `node --experimental-strip-types --test tests/storage-status-routing-contract.test.mjs tests/admin-session-settings.test.mjs`

Expected: all pass.

- [ ] **Step 5: Commit**

Commit message: `feat: route storage status through admin boundary`

### Task 4: Browser-independent CLI client

**Files:**
- Create: `storage-inspect-cli.ts`
- Create: `scripts/storage-inspect.ts`
- Modify: `package.json`
- Test: `tests/storage-inspect-cli.test.mjs`

**Interfaces:**
- Produces `parseStorageInspectCli(argv, env)` and `runStorageInspectCli(options, dependencies)`.
- CLI reads `ADMIN_TOKEN` only from environment and sends `GET /api/admin/storage/status`.

- [ ] **Step 1: Write failing CLI tests**

Cover URL validation, bounded timeout, missing environment token, rejection of token CLI arguments, safe handling of 401/403/503/non-JSON responses, exact sanitized JSON output, and deterministic exit codes.

- [ ] **Step 2: Run focused tests and record RED**

Run: `node --experimental-strip-types --test tests/storage-inspect-cli.test.mjs`

Expected: failure because CLI modules do not exist.

- [ ] **Step 3: Implement parser, runner, and executable**

Allow only `--url` and `--timeout-ms`; use `PORTAL_URL` fallback, require HTTP(S), require `ADMIN_TOKEN` from environment, use `redirect: manual`, print only parsed JSON or fixed safe failures, and never echo the token.

- [ ] **Step 4: Run focused tests to GREEN**

Run: `node --experimental-strip-types --test tests/storage-inspect-cli.test.mjs`

Expected: all pass.

- [ ] **Step 5: Commit**

Commit message: `feat: add storage status CLI client`

### Task 5: Documentation and full verification

**Files:**
- Create: `docs/STORAGE_STATUS.md`
- Modify: `README.md`
- Modify: issue/PR evidence only after code verification

**Interfaces:**
- Documents API schema, role boundary, query bounds, CLI usage, safe outputs, degraded semantics, and rollback.

- [ ] **Step 1: Add documentation and examples**

Document `GET /api/admin/storage/status`, `npm run inspect:storage`, environment-only token policy, HTTP status semantics, and explicit exclusions.

- [ ] **Step 2: Run focused suites**

Run all four new test files with Node test runner.

- [ ] **Step 3: Run repository verification**

Run through CI: lint, production build, complete server suite, per-file matrix, and Auth E2E on the exact head SHA.

- [ ] **Step 4: Review diff and security invariants**

Confirm no DDL/DML, no schema migration files, no Docker health changes, no secret fixtures, no raw table names in API response, and no unresolved review threads.

- [ ] **Step 5: Merge and update #44**

Squash merge only after exact-head CI and Auth E2E success. Comment #44 with evidence and keep it open for integrity/preflight/apply/UI checkpoints.
