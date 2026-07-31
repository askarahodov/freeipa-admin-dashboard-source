# Backup Import Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe administrator-only read-only preflight that validates a sanitized portal backup, compares it with current D1 state, and returns deterministic counts, conflicts, and schema compatibility without restoring anything.

**Architecture:** `backup-import-preview.ts` owns strict document validation, checksum/path verification, schema gating, deterministic comparison, and normalized errors. Current state is loaded only through the existing sanitized read-only domain exporters. `worker/backup-import-preview-entry.ts` owns request limits, schema inspection, audit, safe responses, and delegates comparison without DML, maintenance mode, or upstream calls.

**Tech Stack:** TypeScript, Cloudflare Workers/D1, Web Crypto SHA-256, existing backup manifest/export contracts, existing schema inspector, Node.js test runner, GitHub Actions.

## Global Constraints

- Endpoint is exactly `POST /api/admin/backups/import/preview`.
- Permission is exactly `backup.restore.preview`, granted only to the default admin role.
- Only `mode: sanitized` and current backup format/version are accepted.
- Validate request size and JSON shape before any D1 comparison.
- Validate canonical domain order, allowlist, entry/path/payload bijection, canonical byte counts, SHA-256 checksums, and manifest summary.
- Reject unknown top-level fields, extra/missing payload paths, duplicated domains/paths, corrupted payloads, unsupported modes, future schemas, and incompatible current schema.
- Current schema must be `ready`.
- Older known schema versions return deterministic `requiredMigrations`; no migration is executed.
- Comparison is append/update preview only; absence in backup is `removeIgnored`, never a delete.
- Conflict samples contain stable identifiers only and are bounded.
- No restore commit endpoint, DML/DDL, maintenance mode, upstream fetch, payload persistence, credentials, hashes, tokens, or raw SQL errors.
- Success and failure audit metadata never contains backup payloads or current row contents.

---

## File Structure

- Create `backup-import-preview.ts`: document parser, integrity validation, compatibility gate, deterministic comparison and result types.
- Create `worker/backup-import-preview-entry.ts`: body limit, JSON parse, schema inspection, orchestration, safe errors and audit.
- Modify `worker/index.ts`: permission catalogue, admin permission set, import and route delegation.
- Create `tests/backup-import-validation.test.mjs`: structure, manifest, path, checksum, byte and sanitizer rejection.
- Create `tests/backup-import-comparison.test.mjs`: counts, conflicts, ordering, removeIgnored and all-or-nothing behavior.
- Create `tests/backup-import-api.test.mjs`: request limit, schema compatibility, safe response and sanitized audit.
- Create `tests/backup-import-rbac.test.mjs`: permission and route protection contract.
- Create `tests/backup-import-source-contract.test.mjs`: read-only and secret-free source guard.

---

### Task 1: Strict Backup Document Validation

**Files:**
- Create: `backup-import-preview.ts`
- Create: `tests/backup-import-validation.test.mjs`

**Interfaces:**
- `class BackupImportPreviewError extends Error { code: string; status: number }`
- `type BackupImportDocument = { manifest: PortalBackupManifest; payloads: Record<string, unknown>; summary: { entries: number; records: number; bytes: number } }`
- `async function validateBackupImportDocument(value: unknown): Promise<BackupImportDocument>`

- [ ] Write failing tests for unknown top-level fields, encrypted mode, non-canonical domains, missing/extra paths, mismatched path/domain, byte mismatch, checksum mismatch, records mismatch, summary mismatch and forbidden sanitized fields.
- [ ] Run `node --experimental-strip-types --test tests/backup-import-validation.test.mjs` and verify RED because the module does not exist.
- [ ] Implement strict validation using `validateBackupManifest`, `canonicalBackupJson`, `sha256Hex`, and `assertSanitizedBackupPayload`.
- [ ] Run the focused test and verify GREEN.
- [ ] Commit `feat: validate backup import documents`.

### Task 2: Schema Compatibility and Deterministic Comparison

**Files:**
- Modify: `backup-import-preview.ts`
- Create: `tests/backup-import-comparison.test.mjs`

**Interfaces:**
- `type BackupPreviewSchema = { state: string; currentVersion: number; latestVersion?: number; appliedVersions?: number[] }`
- `type BackupDomainPreview = { domain; incomingRecords; currentRecords; add; update; unchanged; conflict; removeIgnored; conflicts }`
- `async function previewBackupImport(env, document, schema, registry): Promise<BackupImportPreviewResult>`

- [ ] Write failing tests for future schema rejection, older schema migrations, deterministic domain order, add/update/unchanged/conflict/removeIgnored counts, stable bounded conflict identifiers and no partial result after a domain failure.
- [ ] Run the focused test and verify RED.
- [ ] Reuse the existing sanitized exporter registry to read current state; do not add mutation SQL.
- [ ] Implement stable identity rules per domain and canonical record comparison.
- [ ] Run validation and comparison tests and verify GREEN.
- [ ] Commit `feat: compare backup with current portal state`.

### Task 3: Protected Preview API and Sanitized Audit

**Files:**
- Create: `worker/backup-import-preview-entry.ts`
- Modify: `worker/index.ts`
- Create: `tests/backup-import-api.test.mjs`
- Create: `tests/backup-import-rbac.test.mjs`

**Interfaces:**
- `handleBackupImportPreviewRequest(request, env, auditContext, dependencies): Promise<Response>`
- Route: `POST /api/admin/backups/import/preview`
- Permission: `backup.restore.preview`

- [ ] Write failing API/RBAC tests for request limit, malformed JSON, unavailable DB, non-ready/future schema, success response, normalized unexpected failures, admin-only permission and audit metadata without payloads/conflict rows.
- [ ] Run focused tests and verify RED.
- [ ] Implement a 10 MiB pre-parse body limit, schema inspection, strict validation, comparison, no-store JSON responses and best-effort sanitized audit.
- [ ] Add the permission only to the default admin permission set and delegate the exact route.
- [ ] Run focused tests and verify GREEN.
- [ ] Commit `feat: expose backup import preview API`.

### Task 4: Read-Only Security Contract and Full Verification

**Files:**
- Create: `tests/backup-import-source-contract.test.mjs`
- Modify: PR description after verification.

- [ ] Add source guards rejecting DML/DDL, `SELECT *`, maintenance mode, upstream fetch and forbidden secret-bearing identifiers in preview core/route code.
- [ ] Run all backup tests.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run the complete server test suite.
- [ ] Review diff for any restore commit, DML, maintenance mode, payload logging or unbounded conflicts.
- [ ] Update PR description with exact head and CI evidence.
