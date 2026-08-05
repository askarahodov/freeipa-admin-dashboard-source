# Read-only Storage Integrity and Index Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit admin-only bounded storage integrity API and HTTP CLI that run one SQLite quick check and one canonical index inventory without mutation or disclosure of database internals.

**Architecture:** A focused `storage-integrity.ts` service evaluates a fixed `PRAGMA quick_check(1)` and a fixed `sqlite_schema` inventory against `portalSchemaIndexes`, with a process-local single-flight wrapper. `worker/storage-integrity-entry.ts` owns role enforcement, response mapping, correlation ID, and bounded audit. The exact route is composed inside the existing local-session/service-admin boundary and allowed through schema/maintenance recovery gates. `scripts/storage-integrity-inspect.ts` consumes the same HTTP contract.

**Tech Stack:** TypeScript 5.9, Cloudflare D1/SQLite read-only queries, Node.js 22 test runner, existing RBAC/audit/routing helpers, GitHub Actions.

## Global Constraints

- No DDL, DML, migration apply, repair, `REINDEX`, `VACUUM`, `ANALYZE`, `PRAGMA optimize`, cleanup, restore, or arbitrary SQL.
- The only integrity statements are fixed compile-time `PRAGMA quick_check(1)` and one fixed `sqlite_schema` index inventory query.
- Request input must never influence identifiers, pragmas, filters, or SQL fragments.
- Responses, CLI output, and audit must not expose database paths, quick-check text, SQL, index/table names, definitions, rows, credentials, tokens, internal URLs, or raw exceptions.
- Viewer/operator/anonymous denial must happen before integrity evaluation.
- Service-admin authorization remains exact-path only and same-origin mutation enforcement remains in the existing local secure boundary.
- Existing health endpoints, storage status, settings composition, scheduled delegation, and Docker HEALTHCHECK remain unchanged.
- Public/audit duration is capped at 60,000 ms; CLI timeout is bounded to 500..30000 ms.

---

### Task 1: Integrity service contract and behavior

**Files:**
- Create: `storage-integrity-contract.ts`
- Create: `storage-integrity.ts`
- Test: `tests/storage-integrity.test.mjs`

**Interfaces:**
- Consumes: `portalSchemaIndexes` from `db/portal-schema.ts`; injected query with `all(sql)` and `first(sql)` methods.
- Produces: `STORAGE_INTEGRITY_PATH`, `StorageIntegrityReport`, and `inspectStorageIntegrity(env, dependencies?)`.

- [ ] **Step 1: Write failing service tests**

Create tests that import the not-yet-existing service and assert:

```js
const report = await inspectStorageIntegrity({ DB: {} }, {
  query,
  now: () => 1_754_400_000_000,
});
assert.equal(report.contractVersion, "1");
assert.equal(report.state, "healthy");
assert.deepEqual(report.quickCheck, {
  state: "healthy",
  code: "storage_quick_check_ok",
});
assert.deepEqual(report.indexes, {
  expected: portalSchemaIndexes.length,
  present: portalSchemaIndexes.length,
  missing: 0,
  mismatched: 0,
  unexpected: 0,
  code: "storage_indexes_ready",
});
assert.deepEqual(calls, [
  "PRAGMA quick_check(1)",
  "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'",
]);
```

Also cover failed/unsupported/unavailable quick-check states, missing/mismatched/unexpected counts, inventory failure, no DB binding, redaction, safe count caps, and overlapping-call single-flight.

- [ ] **Step 2: Run RED verification**

Run the complete repository suite through PR CI. Expected failure: only the new service test cannot import `storage-integrity.ts`/contract.

- [ ] **Step 3: Implement the fixed contract and evaluator**

Implement:

```ts
export const STORAGE_INTEGRITY_PATH = "/api/admin/storage/integrity/check" as const;

export type StorageIntegrityReport = {
  contractVersion: "1";
  generatedAt: number;
  durationMs: number;
  state: "healthy" | "degraded" | "unavailable";
  quickCheck: {
    state: "healthy" | "failed" | "unsupported" | "unavailable";
    code:
      | "storage_quick_check_ok"
      | "storage_quick_check_failed"
      | "storage_quick_check_unsupported"
      | "storage_quick_check_unavailable";
  };
  indexes: {
    expected: number;
    present: number;
    missing: number;
    mismatched: number;
    unexpected: number;
    code: "storage_indexes_ready" | "storage_indexes_degraded" | "storage_indexes_unavailable";
  };
};
```

Use one module-level in-flight promise. Clear it in `finally`. Do not retain completed reports.

Normalize expected/actual index SQL internally by lowercasing, collapsing whitespace, stripping `IF NOT EXISTS`, and trimming. Build all expected identifiers from `portalSchemaIndexes`; never accept request data.

- [ ] **Step 4: Run GREEN verification**

Run focused service tests, lint, build, and complete server suite in GitHub Actions. Expected: all pass.

- [ ] **Step 5: Commit**

Commit message:

```text
feat: add bounded storage integrity evaluator
```

---

### Task 2: Admin API and bounded audit

**Files:**
- Create: `worker/storage-integrity-entry.ts`
- Test: `tests/storage-integrity-api.test.mjs`

**Interfaces:**
- Consumes: `STORAGE_INTEGRITY_PATH`, `inspectStorageIntegrity`, existing `encryptedBackupAccess`, `createAuditContext`, and `appendAuditEvent`.
- Produces: `handleStorageIntegrityRequest(request, env, dependencies?)` returning `Promise<Response | null>`.

- [ ] **Step 1: Write failing API tests**

Cover unrelated-route passthrough, `POST`-only behavior with `Allow: POST`, viewer/operator denial before evaluation/context creation, admin healthy/degraded/unavailable mapping, no-store/correlation headers, bounded audit metadata, audit failure isolation, and unexpected evaluator failure redaction.

Expected audit shape:

```js
{
  action: "storage.integrity.check",
  resourceType: "portal-storage",
  outcome: "success",
  metadata: {
    state: "healthy",
    durationMs: 0,
    quickCheckCode: "storage_quick_check_ok",
    indexCode: "storage_indexes_ready",
    expected: 19,
    present: 19,
    missing: 0,
    mismatched: 0,
    unexpected: 0,
  },
}
```

- [ ] **Step 2: Run RED verification**

Run complete suite. Expected failure: only the new API test cannot import the handler.

- [ ] **Step 3: Implement handler**

Use the existing storage-status handler pattern, but require `POST`. Reject non-admin principals before `inspectStorageIntegrity`. Map `unavailable` to HTTP 503 and `healthy`/`degraded` to HTTP 200. Return only fixed unexpected-failure payloads.

- [ ] **Step 4: Run GREEN verification**

Run focused API tests, lint, build, and complete server suite. Expected: all pass.

- [ ] **Step 5: Commit**

Commit message:

```text
feat: add admin storage integrity endpoint
```

---

### Task 3: Runtime routing and recovery composition

**Files:**
- Modify: `admin-session-authorization.ts`
- Modify: `worker/local-secure-entry.ts`
- Modify: `worker/schema-migrations-entry.ts`
- Modify: `worker/maintenance-mode-gate.ts`
- Test: `tests/storage-integrity-routing-contract.test.mjs`

**Interfaces:**
- Consumes: exact `STORAGE_INTEGRITY_PATH` and `handleStorageIntegrityRequest`.
- Produces: authenticated runtime dispatch for local admin and explicit service-admin requests without changing outer health/settings composition.

- [ ] **Step 1: Write failing routing/source contracts**

Assert:

```js
assert.match(localSecureSource, /handleStorageIntegrityRequest\(delegatedRequest, delegated\)/);
assert.match(localSecureSource, /handleStorageIntegrityRequest\(request, delegated\)/);
assert.match(authorizationSource, /STORAGE_INTEGRITY_PATH/);
assert.match(schemaEntrySource, /url\.pathname === STORAGE_INTEGRITY_PATH/);
assert.match(maintenanceGateSource, /STORAGE_INTEGRITY_PATH/);
```

Also assert local-session resolution and delegated request creation occur before local integrity dispatch; constant-time service-token authorization occurs before service integrity dispatch; Dockerfile still contains `/health/live` and no integrity path; storage integrity source contains no mutating SQL tokens or request-controlled SQL.

- [ ] **Step 2: Run RED verification**

Run complete suite and Auth E2E source contracts. Expected failure: only new routing assertions.

- [ ] **Step 3: Add exact route composition**

Add the path to the explicit admin integration set and schema/maintenance recovery allowlists. Import/dispatch the handler inside `worker/local-secure-entry.ts` alongside storage status after existing local-session or service-token resolution. Preserve direct `settings-input-normalizer-entry` composition and scheduled delegation.

- [ ] **Step 4: Run GREEN verification**

Run routing test, complete suite, lint, build, and Auth E2E. Expected: all pass.

- [ ] **Step 5: Commit**

Commit message:

```text
feat: route storage integrity through admin recovery boundary
```

---

### Task 4: Browser-independent integrity CLI

**Files:**
- Create: `storage-integrity-inspect-cli.ts`
- Create: `scripts/storage-integrity-inspect.ts`
- Modify: `package.json`
- Test: `tests/storage-integrity-inspect-cli.test.mjs`

**Interfaces:**
- Consumes: exact integrity path and versioned response contract.
- Produces: `parseStorageIntegrityInspectArgs`, `runStorageIntegrityInspect`, and npm script `inspect:storage-integrity`.

- [ ] **Step 1: Write failing CLI tests**

Cover default URL, explicit `--url`, bounded `--timeout-ms`, token-only-from-environment, rejection of token/header/password/cookie/auth arguments, POST method, redirect rejection, content-type/contract validation, exit codes 0/2/3/4/5, and output redaction.

- [ ] **Step 2: Run RED verification**

Run complete suite. Expected failure: only missing CLI module/script.

- [ ] **Step 3: Implement parser and runner**

Follow the existing storage CLI safety model. Build the endpoint from a validated HTTP(S) origin and `STORAGE_INTEGRITY_PATH`, use `redirect: "manual"`, `method: "POST"`, `content-type: application/json`, an empty JSON body, and `x-admin-token` from `ADMIN_TOKEN` only. Print formatted JSON only for valid reports; print fixed machine-readable codes for failures.

- [ ] **Step 4: Run GREEN verification**

Run focused CLI tests, lint, build, and complete suite. Expected: all pass.

- [ ] **Step 5: Commit**

Commit message:

```text
feat: add storage integrity inspector CLI
```

---

### Task 5: Operations documentation and regression verification

**Files:**
- Create: `docs/STORAGE_INTEGRITY.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-05-storage-integrity-readonly.md`

**Interfaces:**
- Consumes: final API/CLI behavior.
- Produces: operator runbook and completed plan evidence.

- [ ] **Step 1: Document endpoint, CLI, states, exit codes, bounds, redaction, and rollback**

Include exact commands:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='read-from-a-secret-provider' \
npm run inspect:storage-integrity
```

State explicitly that this check does not repair storage and must not be used as liveness/readiness or a restart signal.

- [ ] **Step 2: Update README API/script/docs indexes**

Add the exact endpoint and npm script without changing health guidance.

- [ ] **Step 3: Run exact-head verification**

Required evidence on the final commit:

```text
npm run lint
npm run build
node --experimental-strip-types --test tests/storage-integrity*.test.mjs
npm test
Auth E2E workflow
all required PR checks
```

Review the diff for request-controlled SQL, mutating statements, raw error/result leakage, index/table names in public payloads, health/Docker changes, and unrelated refactors.

- [ ] **Step 4: Mark plan checkboxes complete and commit**

Commit message:

```text
docs: document storage integrity diagnostics
```

- [ ] **Step 5: Finish branch**

Mark the draft PR ready only after exact-head verification and no unresolved review threads. Squash merge with expected head SHA. Comment on issue #44 with merged evidence and leave it open for migration preflight/lock, controlled apply, and Storage Center UI.
