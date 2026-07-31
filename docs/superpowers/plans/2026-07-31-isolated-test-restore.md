# Isolated Backup Test Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add domain-selective encrypted preview approval tokens and administrator-only isolated in-memory test restore without production database mutation.

**Architecture:** Extend encrypted preview with canonical domain selection and a deterministic optimistic concurrency token built from selected backup entries, current schema and full current-domain fingerprints. Add a request-scoped memory restore database that stages validated full payloads, runs domain invariants and returns safe verification counts. The test-restore endpoint recomputes and constant-time verifies the token before creating the isolated store.

**Tech Stack:** TypeScript, Node.js 22 test runner with `--experimental-strip-types`, Web Crypto SHA-256, Cloudflare Worker Request/Response APIs, existing D1 read-only exporters.

## Global Constraints

- Production `env.DB` is read-only in this PR.
- No `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, DDL, migrations, maintenance mode or restore commit endpoint.
- No upstream `fetch` or external service calls.
- `CONFIG_ENCRYPTION_KEY` is not read by new restore-plan/test-restore modules.
- Approval tokens, token material, full fingerprints, passwords, hashes, encrypted blobs and plaintext rows are never returned or audited.
- Viewer and operator requests are rejected before schema inspection, D1 reads, password processing, token calculation or isolated store creation.
- Domain selections are non-empty, duplicate-free subsets of manifest domains and are returned in `PORTAL_BACKUP_DOMAINS` order.
- Test restore is all-or-nothing and request-scoped.
- Existing encrypted preview requests without `domains` remain backward compatible.

---

### Task 1: Canonical domain selection

**Files:**
- Create: `backup-restore-selection.ts`
- Test: `tests/backup-restore-selection.test.mjs`

**Interfaces:**
- Produces: `BackupRestoreSelectionError`, `selectBackupRestoreDomains(manifestDomains, requestedDomains)`.
- Consumes: `PORTAL_BACKUP_DOMAINS`, `PortalBackupDomain`.

- [ ] **Step 1: Write failing selection tests**

Test canonicalization, omitted selection, empty selection, duplicate domains, unknown domains, non-array input and a domain absent from the manifest.

```js
assert.deepEqual(
  selectBackupRestoreDomains(["settings", "local-auth", "rbac"], ["rbac", "settings"]),
  ["settings", "rbac"],
);
```

- [ ] **Step 2: Run and verify RED**

```bash
node --experimental-strip-types --test tests/backup-restore-selection.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement strict selection**

Use exact allowlists and return a fresh canonical array. Do not accept coercion from strings or iterables.

- [ ] **Step 4: Run and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add backup-restore-selection.ts tests/backup-restore-selection.test.mjs
git commit -m "feat: add backup restore domain selection"
```

### Task 2: Full current-state fingerprints and approval token

**Files:**
- Create: `backup-restore-plan.ts`
- Test: `tests/backup-restore-plan.test.mjs`

**Interfaces:**
- Consumes: `EncryptedBackupDocument`, `FullBackupDomainExporter`, `validateFullBackupDomainPayload`, `canonicalBackupJson`, `sha256Hex`.
- Produces:
  - `BACKUP_RESTORE_PLAN_VERSION = 1`;
  - `BackupRestorePlan`;
  - `createBackupRestorePlan(env, document, selectedDomains, currentSchemaVersion, fullRegistry)`;
  - `verifyBackupRestoreApprovalToken(expected, provided)`.

- [ ] **Step 1: Write failing deterministic token tests**

Use fixed encrypted manifest entries and fixed current full exporter payloads. Assert exact 64-character lowercase hex output and canonical selected-domain order.

- [ ] **Step 2: Add change-sensitivity tests**

Assert token changes when any of these changes:

- selected domain list;
- selected entry SHA-256, bytes or record count;
- source schema version;
- current schema version;
- any current full row, including a secret-bearing field.

- [ ] **Step 3: Add safe-surface tests**

Assert returned `BackupRestorePlan` contains only `version`, `selectedDomains`, `approvalToken`; current fingerprints and token material remain local variables.

- [ ] **Step 4: Verify RED**

```bash
node --experimental-strip-types --test tests/backup-restore-plan.test.mjs
```

- [ ] **Step 5: Implement current full fingerprints**

For each selected domain:

```ts
const exported = await exporter.export(env, currentSchemaVersion);
const payload = validateFullBackupDomainPayload(domain, exported.payload);
const records = payload.tables.reduce((sum, table) => sum + table.rows.length, 0);
if (records !== exported.records) throw new BackupRestorePlanError(...);
const sha256 = await sha256Hex(canonicalBackupJson(payload));
```

Build token material using selected manifest entries and current full digests, canonicalize and hash it. Never return the material.

- [ ] **Step 6: Implement constant-time verification**

Require strict lowercase SHA-256 hex. Decode expected/provided into 32-byte arrays and OR every XOR difference without early exit.

- [ ] **Step 7: Verify GREEN and commit**

```bash
git add backup-restore-plan.ts tests/backup-restore-plan.test.mjs
git commit -m "feat: bind restore preview to current state"
```

### Task 3: Selected encrypted payload decryption

**Files:**
- Modify: `backup-encrypted-preview.ts`
- Test: `tests/backup-encrypted-selection.test.mjs`
- Modify: `tests/backup-encrypted-preview.test.mjs`

**Interfaces:**
- Produces:
  - `decryptEncryptedBackupDomains(value, password, selectedDomains, dependencies)` returning validated full payloads in memory;
  - extended `previewEncryptedBackupImport(..., options)` result with `restorePlan`.
- Consumes: Tasks 1 and 2, existing safe projection and preview engine.

- [ ] **Step 1: Write failing decrypt-selection tests**

Create a multi-domain encrypted document and injected decrypt spy. Assert only selected payload paths are decrypted and projected.

- [ ] **Step 2: Write failing backward-compatibility test**

An omitted selection must decrypt all manifest domains and preserve existing preview counts.

- [ ] **Step 3: Write failing restore-plan result test**

Assert preview response contains exactly:

```js
restorePlan: {
  version: 1,
  selectedDomains: ["settings"],
  approvalToken: /^[0-9a-f]{64}$/,
}
```

- [ ] **Step 4: Verify RED**

```bash
node --experimental-strip-types --test tests/backup-encrypted-preview.test.mjs tests/backup-encrypted-selection.test.mjs
```

- [ ] **Step 5: Refactor decryption narrowly**

Validate the outer encrypted document once, derive the key once, decrypt only selected domains and retain full payloads only within the test-restore/plan call. Project selected payloads for the existing comparison engine.

Create a selected synthetic `BackupImportDocument` whose manifest entries, payload paths and summary contain only selected domains, while preserving source metadata.

- [ ] **Step 6: Compute restore plan after safe preview**

Use `FULL_BACKUP_EXPORTERS` or an injected full registry. Keep existing sanitized registry separate.

- [ ] **Step 7: Verify existing and new tests GREEN; commit**

```bash
git add backup-encrypted-preview.ts tests/backup-encrypted-preview.test.mjs tests/backup-encrypted-selection.test.mjs
git commit -m "feat: add selective encrypted restore preview plans"
```

### Task 4: Request-scoped isolated restore database

**Files:**
- Create: `backup-isolated-store.ts`
- Test: `tests/backup-isolated-store.test.mjs`

**Interfaces:**
- Consumes: `FullBackupDomainPayload`, `FULL_BACKUP_TABLES`, `canonicalBackupJson`.
- Produces:
  - `IsolatedRestoreStore`;
  - `stageIsolatedRestore(payloads)`;
  - safe table/domain count accessors.

- [ ] **Step 1: Write failing staging tests**

Assert exact tables and positional rows are copied into a fresh store, source arrays are not retained by reference, and counts are deterministic.

- [ ] **Step 2: Write failing all-or-nothing tests**

Inject a duplicate primary key, wrong row width or unexpected table and assert no partial store is returned.

- [ ] **Step 3: Verify RED**

```bash
node --experimental-strip-types --test tests/backup-isolated-store.test.mjs
```

- [ ] **Step 4: Implement the memory store**

Use nested maps keyed by domain/table and canonical primary-key JSON. The module must not import D1 types, Worker env, SQL helpers or network APIs.

- [ ] **Step 5: Verify GREEN and commit**

```bash
git add backup-isolated-store.ts tests/backup-isolated-store.test.mjs
git commit -m "feat: add isolated backup restore store"
```

### Task 5: Isolated consistency verification

**Files:**
- Create: `backup-isolated-verification.ts`
- Test: `tests/backup-isolated-verification.test.mjs`

**Interfaces:**
- Consumes: `IsolatedRestoreStore`, selected domains, source/current schema versions and safe preview result.
- Produces: `verifyIsolatedRestore(...)` returning safe per-domain checks/warnings and aggregate `canCommit`.

- [ ] **Step 1: Write failing common and JSON-field tests**

Verify exact table contract, counts, primary keys and parsing of known JSON columns. Invalid JSON must return `backup_test_restore_failed` without the field value.

- [ ] **Step 2: Write failing local-auth/RBAC tests**

Cover user hash/salt/iterations/role, session→user references, role assignment matching, and the fixed warning when `rbac` is selected without `local-auth`.

- [ ] **Step 3: Write failing settings tests**

Cover JSON fields, integer revisions and staged draft references. Do not decrypt `encrypted_secrets`.

- [ ] **Step 4: Write failing operations/approvals tests**

Cover result/replay/notification/read references and decision→approval references.

- [ ] **Step 5: Write failing safe output tests**

Warnings must be sorted, bounded and contain only fixed codes. Results must not contain row values or identifiers.

- [ ] **Step 6: Verify RED**

```bash
node --experimental-strip-types --test tests/backup-isolated-verification.test.mjs
```

- [ ] **Step 7: Implement deterministic verification**

Set `canCommit` only when preview has no conflicts or required migrations and every isolated check succeeds.

- [ ] **Step 8: Verify GREEN and commit**

```bash
git add backup-isolated-verification.ts tests/backup-isolated-verification.test.mjs
git commit -m "feat: verify isolated backup restore candidates"
```

### Task 6: Test-restore orchestration

**Files:**
- Create: `backup-isolated-restore.ts`
- Test: `tests/backup-isolated-restore.test.mjs`

**Interfaces:**
- Consumes: selected encrypted decryption, restore plan token, isolated store and verifier.
- Produces: `testRestoreEncryptedBackupImport(env, input, schema, sanitizedRegistry, fullRegistry, dependencies)`.

- [ ] **Step 1: Write failing success test**

Preview a fixed document, submit its approval token, and assert a safe result with `tested: true` and `productionMutated: false`.

- [ ] **Step 2: Write failing stale-token tests**

Change current full data, schema, selected domains and backup entry independently. Assert `409 backup_restore_stale` and that the store factory was not called.

- [ ] **Step 3: Write failing wrong-password and invalid-payload tests**

Preserve existing normalized crypto/full-payload errors.

- [ ] **Step 4: Verify RED**

```bash
node --experimental-strip-types --test tests/backup-isolated-restore.test.mjs
```

- [ ] **Step 5: Implement strict orchestration order**

1. validate selection and schema;
2. validate encrypted document;
3. recompute current plan/token;
4. constant-time token check;
5. decrypt selected full payloads;
6. create/stage request-scoped store;
7. verify and return safe result.

- [ ] **Step 6: Verify GREEN and commit**

```bash
git add backup-isolated-restore.ts tests/backup-isolated-restore.test.mjs
git commit -m "feat: test encrypted restores in isolation"
```

### Task 7: Worker API, RBAC and safe audit

**Files:**
- Create: `worker/backup-isolated-restore-entry.ts`
- Modify: `worker/backup-encrypted-root-entry.ts`
- Modify: `worker/backup-encrypted-preview-entry.ts`
- Modify: `worker/freeipa-group-member-entry.ts` only if dispatch order requires it
- Modify: `admin-session-authorization.ts`
- Modify: `portal-permissions.ts`
- Modify: `tests/portal-permissions.test.mjs`
- Create: `tests/backup-isolated-api.test.mjs`
- Create: `tests/backup-isolated-rbac.test.mjs`

**Interfaces:**
- Endpoint: `POST /api/admin/backups/import/encrypted/test-restore`.
- Permission: `backup.restore.test`, admin only.

- [ ] **Step 1: Write failing route/RBAC tests**

Assert viewer/operator receive 403 before handler invocation and admin dispatches preview/test-restore paths correctly.

- [ ] **Step 2: Write failing API tests**

Cover method, 20 MiB body limit, exact request fields, strict approval-token format, unavailable/non-ready DB, success headers and normalized failures.

- [ ] **Step 3: Write failing audit tests**

Success audit includes only domains, versions, aggregate counts/checks/warnings, `canCommit` and duration. Failure audit includes only allowlisted domains, duration and normalized error code. Assert serialized audit metadata excludes `approvalToken`, `password`, `fingerprint`, `sha256`, `salt`, `iv`, `ciphertext`, `hash` and payload content.

- [ ] **Step 4: Update browser permission catalogue tests first**

Add `backup.restore.test` to the admin matrix and metadata before runtime exposes it.

- [ ] **Step 5: Implement route and authorization**

Preserve the existing Worker chain and same-origin administrative path boundary.

- [ ] **Step 6: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/portal-permissions.test.mjs tests/backup-isolated-api.test.mjs tests/backup-isolated-rbac.test.mjs
```

### Task 8: Security source contract and documentation

**Files:**
- Create: `tests/backup-isolated-source-contract.test.mjs`
- Modify: `README.md`
- Modify: `docs/PRODUCT_ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-07-30-portal-backup-restore.md`

- [ ] **Step 1: Write failing source-contract test**

Scan new production modules and fail on:

```text
INSERT UPDATE DELETE REPLACE CREATE ALTER DROP PRAGMA
SELECT *
maintenance
restore/commit
fetch(
console.
CONFIG_ENCRYPTION_KEY
approvalToken in audit metadata
```

Allow the words only in normalized error names, documentation and tests where explicitly scoped.

- [ ] **Step 2: Add dispatch/source regression assertions**

Prove test-restore route is wired once, preview remains backward compatible and production DB is referenced only by read-only full/sanitized exporters and schema inspection.

- [ ] **Step 3: Verify RED, then adjust production source only**

```bash
node --experimental-strip-types --test tests/backup-isolated-source-contract.test.mjs
```

- [ ] **Step 4: Update effective documentation**

Document selection, approval token, isolated memory restore, safe checks and explicit absence of production restore.

- [ ] **Step 5: Run focused suite**

```bash
node --experimental-strip-types --test \
  tests/backup-restore-selection.test.mjs \
  tests/backup-restore-plan.test.mjs \
  tests/backup-encrypted-preview.test.mjs \
  tests/backup-encrypted-selection.test.mjs \
  tests/backup-isolated-store.test.mjs \
  tests/backup-isolated-verification.test.mjs \
  tests/backup-isolated-restore.test.mjs \
  tests/backup-isolated-api.test.mjs \
  tests/backup-isolated-rbac.test.mjs \
  tests/backup-isolated-source-contract.test.mjs \
  tests/portal-permissions.test.mjs
```

- [ ] **Step 6: Open draft PR and run repository CI**

Require lint, build, complete server suite, individual matrix tests and Auth E2E.

- [ ] **Step 7: Review and harden**

Inspect the full PR patch, review threads and workflow logs. Fix every critical/important finding and rerun CI on the final head.

- [ ] **Step 8: Mark ready for review**

Update the PR body with exact scope, exclusions, final head SHA and CI evidence. Do not merge without a separate explicit instruction.
