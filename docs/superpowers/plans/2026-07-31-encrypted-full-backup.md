# Encrypted Full Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-only encrypted logical full backup export and read-only encrypted import preview without restore mutation, maintenance mode or persistence of backup credentials.

**Architecture:** Keep the existing versioned manifest and canonical domain paths. Add a focused Web Crypto module, an exhaustive full-domain table registry, an encrypted export orchestrator and an encrypted preview pipeline that validates outer integrity before decrypting, projects full payloads into existing safe comparison records and reuses the current read-only D1 preview engine. Route modules own size limits, RBAC and sanitized audit only.

**Tech Stack:** TypeScript, Node.js 22 test runner with `--experimental-strip-types`, Web Crypto PBKDF2-SHA-256/AES-256-GCM, Cloudflare Worker Request/Response APIs, D1 explicit-column queries.

## Global Constraints

- `CONFIG_ENCRYPTION_KEY` is never read or included in a backup.
- Backup passwords, derived keys, salt, IV, ciphertext and plaintext rows are never logged or audited.
- KDF: PBKDF2-SHA-256, minimum 210000 iterations.
- Encryption: AES-256-GCM, independent 96-bit IV per domain payload.
- Each encryption operation authenticates format, version, schema version, domain and canonical path as AAD.
- Outer manifest entry bytes/checksum describe the canonical encrypted envelope.
- Wrong password and tampering return the same normalized `backup_decryption_failed` error.
- No INSERT, UPDATE, DELETE, DDL, migrations, maintenance mode, restore commit, upstream call or server-side backup persistence.
- Both routes require admin-only server-side authorization and `cache-control: no-store`.
- Encrypted preview returns only safe counts and bounded stable conflict identifiers.

---

### Task 1: Cryptographic primitives and encrypted envelope contract

**Files:**
- Create: `backup-encryption.ts`
- Test: `tests/backup-encryption.test.mjs`

**Interfaces:**
- Produces: `BACKUP_KDF_ITERATIONS`, `MAX_BACKUP_PASSWORD_BYTES`, `EncryptedPayloadEnvelope`, `BackupCryptoRandom`, `validateBackupPassword`, `createBackupSalt`, `createBackupIv`, `backupPayloadAad`, `encryptBackupPayload`, `decryptBackupPayload`, `validateEncryptedEnvelope`.
- Consumes: `canonicalBackupJson` from `backup-manifest.ts`.

- [ ] **Step 1: Write failing password/KDF/base64 tests**

Test that empty, oversized and invalid UTF-8-size passwords are rejected; iterations below 210000 are rejected; IV decodes to exactly 12 bytes; salt decodes to at least 16 bytes; ciphertext must be strict canonical base64 and bounded.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/backup-encryption.test.mjs
```

Expected: failure because `backup-encryption.ts` does not exist.

- [ ] **Step 3: Implement validation and encoding helpers**

Implement strict base64 round-trip validation, byte limits and normalized `BackupEncryptionError` values. Do not accept URL-safe or whitespace-containing base64.

- [ ] **Step 4: Add failing fixed-fixture encryption tests**

Use injected fixed salt/IV and assert:

```ts
const aad = backupPayloadAad({
  format: "freeipa-admin-dashboard-backup",
  version: 1,
  schemaVersion: 1,
  domain: "settings",
  path: "domains/settings.json",
});
```

Verify deterministic ciphertext for the fixture, successful round trip, different IVs produce different ciphertext and changed domain/path/schema AAD fails decryption.

- [ ] **Step 5: Implement PBKDF2 and AES-GCM**

Use:

```ts
crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"])
crypto.subtle.deriveKey(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations },
  keyMaterial,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"],
)
```

Encrypt canonical plaintext bytes with `{ name: "AES-GCM", iv, additionalData: aadBytes, tagLength: 128 }`.

- [ ] **Step 6: Verify GREEN and tamper failures**

Run the focused test. Confirm wrong password, modified salt/IV/AAD/ciphertext all throw only `backup_decryption_failed` with no low-level crypto message.

- [ ] **Step 7: Commit**

```bash
git add backup-encryption.ts tests/backup-encryption.test.mjs
git commit -m "feat: add encrypted backup crypto primitives"
```

### Task 2: Full table-bundle model and exhaustive domain registry

**Files:**
- Create: `backup-full-domains.ts`
- Test: `tests/backup-full-domains.test.mjs`
- Modify: `backup-manifest.ts`

**Interfaces:**
- Produces: `FullBackupTable`, `FullBackupDomainPayload`, `FullBackupDomainExporter`, `FULL_BACKUP_EXPORTERS`, `validateFullBackupDomainPayload`.
- Consumes: `PortalBackupDomain`, `PORTAL_BACKUP_DOMAINS`, `BackupExportEnv`, `BackupExportError`.

- [ ] **Step 1: Write failing registry/model tests**

Assert the registry is exhaustive and canonical, every table declares fixed columns and primary key columns, every SQL statement starts with `SELECT` and contains no `*`, DML or DDL.

- [ ] **Step 2: Define exact domain ownership in tests**

Expected table registry:

```text
settings:
  app_settings
  portal_settings_drafts
  portal_settings_apply_commits
  portal_settings_revisions
  portal_settings_draft_resets
  portal_settings_sources
local-auth:
  portal_users
  portal_sessions
rbac:
  portal_users (identity/role projection stored as a distinct table bundle entry is forbidden; ownership remains local-auth)
policies:
  catalog_visibility_policies
  approval_policy_sets
  process_presentation_sets
catalog:
  xyops_catalog_snapshot
  xyops_catalog_history
  xyops_catalog_sync_runs
operations:
  operation_runs
  operation_run_results
  operation_run_replays
  operation_notifications
  operation_notification_reads
approvals:
  operation_approvals
  operation_approval_decisions
audit:
  portal_audit_events
```

The `rbac` domain payload contains a deterministic logical `portal_role_assignments` table derived from explicit `portal_users(id, username, role, disabled, updated_at)` reads. No physical table is claimed twice.

- [ ] **Step 3: Run and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/backup-full-domains.test.mjs
```

- [ ] **Step 4: Implement table bundle validation**

Payload shape:

```ts
type FullBackupDomainPayload = {
  domain: PortalBackupDomain;
  schemaVersion: number;
  tables: Array<{
    name: string;
    columns: string[];
    primaryKey: string[];
    rows: unknown[][];
  }>;
};
```

Reject unknown/duplicate tables, column drift, invalid row width, duplicate primary keys and non-JSON-safe values.

- [ ] **Step 5: Implement explicit-column exporters**

Each table descriptor owns a literal SQL statement with deterministic `ORDER BY` using the full primary key. Map result objects to positional arrays in declared column order. Include encrypted blobs and password/session recovery fields listed by the design, but never read `CONFIG_ENCRYPTION_KEY` or caller credentials.

- [ ] **Step 6: Add sensitive recovery field assertions**

Tests must prove the declared columns include:

```text
app_settings.encrypted_secrets
portal_users.password_hash/password_salt/password_iterations
portal_sessions.token_hash
portal_settings_drafts.encrypted_secrets
portal_settings_apply_commits.encrypted_secrets
portal_settings_revisions.encrypted_secrets
operation_run_replays.encrypted_spec
operation_approvals.encrypted_spec
```

Also assert forbidden standalone identifiers `CONFIG_ENCRYPTION_KEY`, `backup_password`, `backup_key`, `ipa_password` and `xyops_api_key` never occur in exporter source.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/backup-full-domains.test.mjs
git add backup-full-domains.ts backup-manifest.ts tests/backup-full-domains.test.mjs
git commit -m "feat: add full backup domain exporters"
```

### Task 3: Encrypted export orchestration

**Files:**
- Create: `backup-encrypted-export.ts`
- Test: `tests/backup-encrypted-export.test.mjs`

**Interfaces:**
- Produces: `EncryptedBackupDocument`, `EncryptedBackupExportOptions`, `parseEncryptedBackupExportRequest`, `exportEncryptedBackup`.
- Consumes: `FULL_BACKUP_EXPORTERS`, `encryptBackupPayload`, `createBackupEntry`, `validateBackupManifest`.

- [ ] **Step 1: Write failing request tests**

Require exact fields `domains` and `password`; reject unknown fields, empty domains, duplicates, unsupported domains, empty/oversized password. Normalize domains into `PORTAL_BACKUP_DOMAINS` order.

- [ ] **Step 2: Write failing deterministic document test**

Inject fixed `createdAt`, salt and per-domain IV provider. Assert:

- manifest mode is `encrypted`;
- encryption metadata is exact;
- entry paths are canonical;
- checksum/bytes match canonical encrypted envelopes;
- summary totals encrypted envelope bytes and source record counts;
- plaintext recovery fields do not occur in serialized outer document.

- [ ] **Step 3: Run and verify RED**

```bash
node --experimental-strip-types --test tests/backup-encrypted-export.test.mjs
```

- [ ] **Step 4: Implement all-or-nothing export**

Export each domain sequentially, validate its full payload, canonicalize, encrypt with independent IV/AAD, calculate the entry from the encrypted envelope and only return the document after `validateBackupManifest` succeeds.

- [ ] **Step 5: Test exporter/crypto failures**

A failure in any domain or encryption step returns no partial document and maps to a stable `BackupEncryptedExportError` code.

- [ ] **Step 6: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/backup-encrypted-export.test.mjs
git add backup-encrypted-export.ts tests/backup-encrypted-export.test.mjs
git commit -m "feat: orchestrate encrypted full backup export"
```

### Task 4: Full payload safe projections

**Files:**
- Create: `backup-full-projections.ts`
- Test: `tests/backup-full-projections.test.mjs`

**Interfaces:**
- Produces: `projectFullBackupDomain(domain, payload): { records: Record<string, unknown>[] }`.
- Consumes: `validateFullBackupDomainPayload`.

- [ ] **Step 1: Write failing projection equivalence tests**

For every domain, construct a full table fixture and assert the projection matches the existing sanitized exporter record shape and stable identity fields used by `backup-import-preview.ts`.

- [ ] **Step 2: Assert secret removal**

Projected data must not include password hashes/salts, token hashes, encrypted secrets, encrypted specs or raw secret values. Run `assertSanitizedBackupPayload` over every projection.

- [ ] **Step 3: Run RED, implement minimal projections and verify GREEN**

```bash
node --experimental-strip-types --test tests/backup-full-projections.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add backup-full-projections.ts tests/backup-full-projections.test.mjs
git commit -m "feat: project full backups for safe comparison"
```

### Task 5: Encrypted document validation, decryption and read-only preview

**Files:**
- Create: `backup-encrypted-preview.ts`
- Test: `tests/backup-encrypted-preview.test.mjs`
- Modify: `backup-import-preview.ts`

**Interfaces:**
- Produces: `validateEncryptedBackupDocument`, `decryptEncryptedBackupDocument`, `previewEncryptedBackupImport`.
- Consumes: `validateBackupManifest`, `validateEncryptedEnvelope`, `decryptBackupPayload`, `validateFullBackupDomainPayload`, `projectFullBackupDomain`, `previewBackupImport`.

- [ ] **Step 1: Write failing outer validation tests**

Reject sanitized mode, missing/extra paths, non-canonical domain order, wrong encrypted-envelope checksum/bytes, summary mismatch, weak KDF, invalid salt/IV/base64 and oversized decoded ciphertext before password derivation.

- [ ] **Step 2: Write failing decryption tests**

Verify wrong password and any salt/IV/ciphertext/AAD modification return only `backup_decryption_failed`, without partial projections or raw crypto text.

- [ ] **Step 3: Write failing preview equivalence test**

Encrypt fixed full payload fixtures, decrypt/project them and assert the resulting per-domain/aggregate counts equal the existing sanitized preview engine for equivalent safe records.

- [ ] **Step 4: Implement strict validation order**

Perform outer structure/checksum/schema checks first, derive the key only once, decrypt each domain into a local scope, parse canonical JSON, validate the full table bundle, immediately project to safe records and discard the full payload reference before moving to the next domain.

- [ ] **Step 5: Expose a narrow comparison entry point**

Refactor `backup-import-preview.ts` only as needed so comparison accepts a validated manifest plus projected `{records}` payloads. Preserve existing sanitized preview behavior and tests unchanged.

- [ ] **Step 6: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/backup-import-validation.test.mjs tests/backup-import-comparison.test.mjs tests/backup-encrypted-preview.test.mjs
git add backup-encrypted-preview.ts backup-import-preview.ts tests/backup-encrypted-preview.test.mjs
git commit -m "feat: preview encrypted backups read only"
```

### Task 6: Worker routes, RBAC and sanitized audit

**Files:**
- Create: `worker/backup-encrypted-export-entry.ts`
- Create: `worker/backup-encrypted-preview-entry.ts`
- Create: `worker/backup-encrypted-root-entry.ts`
- Modify: `worker/freeipa-group-member-entry.ts`
- Modify: `admin-session-authorization.ts`
- Modify: `portal-permissions.ts`
- Test: `tests/backup-encrypted-api.test.mjs`
- Test: `tests/backup-encrypted-rbac.test.mjs`
- Modify: `tests/portal-permissions.test.mjs`

**Interfaces:**
- Export endpoint: `POST /api/admin/backups/export/encrypted`.
- Preview endpoint: `POST /api/admin/backups/import/encrypted/preview`.
- Permission: `backup.export.encrypted` for admin only.
- Preview permission: existing route-local `backup.restore.preview` for admin only.

- [ ] **Step 1: Write failing RBAC/source dispatch tests**

Viewer/operator receive 403 before schema inspection, D1 reads, password processing or crypto. Admin dispatches to the route handler. Browser permission metadata contains every runtime catalogue permission.

- [ ] **Step 2: Write failing API request-limit tests**

Export request maximum: 16 KiB. Preview request maximum: 20 MiB before JSON parsing, plus decoded ciphertext total limit enforced by the validator. Missing `content-length` is still checked after reading.

- [ ] **Step 3: Implement export route**

Inspect canonical schema, call `exportEncryptedBackup`, return attachment headers and audit only domains, entry/record/encrypted-byte totals, versions and duration.

- [ ] **Step 4: Implement preview route**

Inspect schema, call `previewEncryptedBackupImport`, return safe preview JSON and audit only domains, versions, safe aggregate counts, `canRestore`, encrypted bytes, normalized error and duration.

- [ ] **Step 5: Add secret-leak assertions**

Audit event JSON and HTTP errors must not contain password, password length, salt, IV, ciphertext, checksum, derived key, plaintext or encrypted secret values.

- [ ] **Step 6: Wire root dispatch without changing existing FreeIPA behavior**

Call `handleEncryptedBackupRoute` before the existing sanitized preview dispatch and otherwise delegate through the unchanged worker chain.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --experimental-strip-types --test tests/backup-encrypted-api.test.mjs tests/backup-encrypted-rbac.test.mjs tests/portal-permissions.test.mjs
git add worker/backup-encrypted-export-entry.ts worker/backup-encrypted-preview-entry.ts worker/backup-encrypted-root-entry.ts worker/freeipa-group-member-entry.ts admin-session-authorization.ts portal-permissions.ts tests/backup-encrypted-api.test.mjs tests/backup-encrypted-rbac.test.mjs tests/portal-permissions.test.mjs
git commit -m "feat: expose encrypted backup APIs"
```

### Task 7: Security source contracts and regression suite

**Files:**
- Create: `tests/backup-encrypted-source-contract.test.mjs`
- Modify: `tests/backup-export-rbac.test.mjs`
- Modify: `tests/backup-import-rbac.test.mjs`

**Interfaces:**
- Consumes all encrypted backup production modules.
- Produces static guarantees enforced by standard test discovery.

- [ ] **Step 1: Write source guard**

Reject in encrypted backup modules:

```text
INSERT
UPDATE
DELETE
CREATE
ALTER
DROP
REINDEX
SELECT *
maintenance mode identifiers
restore commit endpoints
upstream fetch calls
console logging
CONFIG_ENCRYPTION_KEY
raw password/key audit fields
```

Allow `crypto.subtle` only in `backup-encryption.ts`.

- [ ] **Step 2: Add runtime negative tests**

Prove no DB mutation method (`run`, `batch`, mutation SQL) is invoked during encrypted export or preview. Prove no audit receives request bodies or payload envelopes.

- [ ] **Step 3: Run focused and full server suites**

```bash
node --experimental-strip-types --test tests/backup-*.test.mjs tests/portal-permissions.test.mjs
node --experimental-strip-types --test tests/*.test.mjs
```

Expected: zero failures.

- [ ] **Step 4: Commit**

```bash
git add tests/backup-encrypted-source-contract.test.mjs tests/backup-export-rbac.test.mjs tests/backup-import-rbac.test.mjs
git commit -m "test: enforce encrypted backup security boundaries"
```

### Task 8: Documentation, build verification and PR

**Files:**
- Modify: `README.md`
- Modify: `docs/PRODUCT_ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-07-30-portal-backup-restore.md`

- [ ] **Step 1: Document effective behavior**

Document both endpoints, password handling, crypto format, size limits, admin-only RBAC, no server-side storage, no `CONFIG_ENCRYPTION_KEY`, and explicit absence of restore/maintenance mode.

- [ ] **Step 2: Run production verification**

```bash
npm run lint
npm run build
node --experimental-strip-types --test tests/*.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 3: Review diff against scope**

Confirm no schema migration, restore endpoint, DML/DDL, maintenance mode, backup persistence, archive packaging or remote storage was introduced.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md docs/PRODUCT_ROADMAP.md docs/superpowers/plans/2026-07-30-portal-backup-restore.md
git commit -m "docs: describe encrypted full backup"
```

- [ ] **Step 5: Push branch and open draft PR**

Title:

```text
Add encrypted full backup export and preview
```

Body must include threat model, crypto parameters, routes/RBAC, full domain ownership, audit exclusions, explicit non-goals, exact test evidence and `Part of #37`.
