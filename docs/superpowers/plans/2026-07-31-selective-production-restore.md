# Selective Production Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement administrator-only staged selective production restore with mandatory encrypted recovery point, cancellation, guarded transactional commit and rollback through the same workflow.

**Architecture:** Extend the canonical schema with a metadata-only restore stage table. Prepare reuses encrypted preview and isolated restore, creates a client-held encrypted recovery point and persists only bounded bindings plus a stage-secret hash. Commit revalidates source and recovery documents, claims the stage and applies a fixed guarded D1 batch generated only from allowlisted full-backup table definitions.

**Tech Stack:** TypeScript, Cloudflare Worker/D1 API, Web Crypto SHA-256/PBKDF2/AES-GCM, Node 22 test runner with `--experimental-strip-types`, existing portal RBAC/audit/migration boundaries.

## Global Constraints

- Production restore is admin-only and same-origin protected.
- Never persist or audit backup/recovery passwords, approval tokens, stage secrets, plaintext payloads, ciphertext documents, IV, salt, checksums or full current-state fingerprints.
- Never accept table or column names from HTTP requests or backup payload metadata for SQL construction.
- `audit` is not a selective commit domain.
- `rbac` is derived from `portal_users` and produces no DML.
- `operations` and `approvals` must be selected together.
- `local-auth` restores users but revokes all sessions and must contain an active administrator.
- No maintenance mode, destructive full restore, schema migration during restore, remote storage or CLI recovery in this PR.
- Every production behavior change follows RED → GREEN → REFACTOR and ends with a focused test commit.

---

### Task 1: Canonical restore stage schema

**Files:**
- Modify: `db/portal-schema.ts`
- Modify: `db/portal-migrations.ts`
- Create: `db/portal-migration-v2.ts`
- Test: `tests/portal-schema-restore-stage.test.mjs`
- Test: `tests/portal-schema-migrations.test.mjs`

**Interfaces:**
- Produces canonical table `portal_backup_restore_stages` and migration version 2.
- Stage columns exactly match the design document.

- [ ] **Step 1: Write failing schema inventory tests**

Assert the canonical inventory contains the exact stage table columns, types, nullability and primary key, and that migration registry versions are `[1, 2]` while migration v1 checksum inputs remain unchanged.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/portal-schema-restore-stage.test.mjs tests/portal-schema-migrations.test.mjs
```

Expected: failure because migration v2 and the stage table do not exist.

- [ ] **Step 3: Add migration v2 and canonical inventory**

Create additive SQL only:

```sql
CREATE TABLE IF NOT EXISTS portal_backup_restore_stages (
  id TEXT PRIMARY KEY NOT NULL,
  operation TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  selected_domains_json TEXT NOT NULL,
  stage_secret_hash TEXT NOT NULL,
  source_binding_hash TEXT NOT NULL,
  recovery_binding_hash TEXT NOT NULL,
  source_schema_version INTEGER NOT NULL,
  current_schema_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
)
```

Register immutable migration version `2`, name `backup-restore-stage-metadata`, with a snapshot that includes the final canonical schema.

- [ ] **Step 4: Run focused schema tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add db/portal-schema.ts db/portal-migrations.ts db/portal-migration-v2.ts tests/portal-schema-restore-stage.test.mjs tests/portal-schema-migrations.test.mjs
git commit -m "Add restore stage metadata migration"
```

### Task 2: Selective domain policy

**Files:**
- Create: `backup-selective-restore-policy.ts`
- Test: `tests/backup-selective-restore-policy.test.mjs`

**Interfaces:**
- Produces `validateSelectiveRestoreDomains(value: unknown): SelectiveRestorePolicyResult`.
- Result fields: `selectedDomains`, `physicalDomains`, `sessionPolicy: "revoke"`, `operationApprovalBundle: boolean`.

- [ ] **Step 1: Write failing policy tests**

Cover canonical ordering, duplicate/unknown rejection, `audit` rejection, `rbac` requiring `local-auth`, `operations` and `approvals` requiring each other, and physical-domain normalization that removes logical `rbac`.

- [ ] **Step 2: Run focused test and verify RED**

- [ ] **Step 3: Implement the fixed policy**

Use `PORTAL_BACKUP_DOMAINS`; do not infer dependencies from payload contents.

- [ ] **Step 4: Run focused test and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add backup-selective-restore-policy.ts tests/backup-selective-restore-policy.test.mjs
git commit -m "Add selective restore domain policy"
```

### Task 3: Stage secret and binding primitives

**Files:**
- Create: `backup-restore-stage.ts`
- Test: `tests/backup-restore-stage.test.mjs`

**Interfaces:**
- Produces `createRestoreStageSecret(randomValues?)`, `hashRestoreStageSecret(secret)`, `createRestoreStageBinding(input)`, `verifyRestoreStageSecret(expectedHash, provided)`.
- Stage secrets are canonical base64url random 32-byte values.
- Verification uses a constant-time byte loop.

- [ ] **Step 1: Write failing cryptographic primitive tests**

Test strict secret shape, deterministic injected entropy, binding changes for actor/domains/source/recovery/schema/operation, malformed secret rejection and constant-time verification behavior.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement minimal Web Crypto helpers**

Do not export raw binding material.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

### Task 4: Stage repository lifecycle

**Files:**
- Create: `backup-restore-stage-repository.ts`
- Test: `tests/backup-restore-stage-repository.test.mjs`

**Interfaces:**
- Produces `createRestoreStage`, `loadRestoreStage`, `cancelRestoreStage` and SQL guard helpers.
- Repository accepts a D1-compatible database interface and never handles backup documents.

- [ ] **Step 1: Write failing repository tests**

Test exact parameterized SQL, prepared status, 15-minute TTL, actor/secret checks, prepared-only cancellation, idempotent cancelled/committed errors and no sensitive field names in stage rows.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement repository with explicit statements**

No `SELECT *`. Return only typed stage metadata.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

### Task 5: Recovery point creation and equality verification

**Files:**
- Create: `backup-selective-recovery-point.ts`
- Modify: `backup-encrypted-export.ts` only to expose a reusable selected-domain document builder if required.
- Test: `tests/backup-selective-recovery-point.test.mjs`

**Interfaces:**
- Produces `createSelectiveRecoveryPoint(env, password, policy, schemaVersion, fullRegistry)`.
- Produces `verifySelectiveRecoveryPoint(env, document, password, policy, schemaVersion, fullRegistry)`.
- Verification compares canonical full payload hashes and records, not safe projections.

- [ ] **Step 1: Write failing recovery tests**

Test selected-domain encryption, password/tamper failure, current-state equality, stale mismatch, `rbac` logical exclusion, audit rejection and no current full fingerprint in returned metadata.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement using existing encrypted export/decrypt primitives**

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

### Task 6: Production write planner

**Files:**
- Create: `backup-selective-write-plan.ts`
- Test: `tests/backup-selective-write-plan.test.mjs`
- Test: `tests/backup-selective-write-source-contract.test.mjs`

**Interfaces:**
- Produces `buildSelectiveRestoreStatements(db, stageGuard, policy, fullPayloads, auditRow)` returning D1 prepared statements.
- Table definitions come only from `FULL_BACKUP_TABLES`.

- [ ] **Step 1: Write failing planner tests**

Assert reverse-order guarded deletes, canonical guarded inserts, no DML for `rbac`, no session inserts for `local-auth`, operations/approvals bundle ordering, stage claim first, audit append and final committed transition.

Source-contract assertions must reject request-derived SQL identifiers, unguarded DML, `REPLACE`, DDL, `SELECT *`, audit delete/update and session insert.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement fixed SQL planner**

Insert rows through:

```sql
INSERT INTO fixed_table (fixed_columns...)
SELECT ?, ?, ...
WHERE EXISTS (
  SELECT 1 FROM portal_backup_restore_stages
  WHERE id = ? AND status = 'committing' AND stage_secret_hash = ?
)
```

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

### Task 7: Prepare orchestration

**Files:**
- Create: `backup-selective-restore-prepare.ts`
- Test: `tests/backup-selective-restore-prepare.test.mjs`

**Interfaces:**
- Produces `prepareSelectiveProductionRestore(env, input, schema, actor, registries, dependencies?)`.
- Returns one-time `stageSecret`, stage metadata, safe isolated result and encrypted recovery document.

- [ ] **Step 1: Write failing prepare tests**

Verify authorization-independent core ordering: policy → source test restore → recovery creation → recovery verification → stage creation. Any failure must create no stage. Test active-admin requirement and safe error normalization.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement orchestration**

The source document and passwords stay request-local.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

### Task 8: Commit orchestration

**Files:**
- Create: `backup-selective-restore-commit.ts`
- Test: `tests/backup-selective-restore-commit.test.mjs`

**Interfaces:**
- Produces `commitSelectiveProductionRestore(env, input, schema, actor, registries, dependencies?)`.
- Uses existing isolated test restore and fresh restore-plan verification.

- [ ] **Step 1: Write failing commit tests**

Cover exact confirmation, stage actor/secret/status/expiry, recovery equality, stale source token before DML, active-admin requirement, batch called exactly once, complete failure on batch error, committed replay rejection and aggregate-only result.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement commit orchestration**

Re-export current state immediately before building the batch. Do not execute any DML outside the single batch.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

### Task 9: API, RBAC, cancellation and audit

**Files:**
- Create: `worker/backup-selective-restore-entry.ts`
- Modify: `worker/backup-encrypted-root-entry.ts`
- Modify: `portal-permissions.ts`
- Modify: `admin-session-authorization.ts`
- Test: `tests/backup-selective-restore-api.test.mjs`
- Test: `tests/backup-selective-restore-rbac.test.mjs`
- Test: `tests/backup-selective-restore-source-contract.test.mjs`

**Interfaces:**
- Routes: `/prepare-commit`, `/commit`, `/cancel`.
- Permissions: `backup.restore.prepare`, `backup.restore.commit`, `backup.restore.cancel`.

- [ ] **Step 1: Write failing API/RBAC/source tests**

Viewer/operator must be denied before body parsing, DB reads, password processing or stage lookup. Admin routes enforce body limits, same-origin, no-store and safe normalized errors. Audit excludes every sensitive field listed in Global Constraints.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement routes and permission metadata**

Use existing admin session boundary and exact runtime/browser permission catalogue.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

### Task 10: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/PRODUCT_ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-07-30-portal-backup-restore.md`
- Modify: `docs/DATABASE_MIGRATIONS.md`

- [ ] **Step 1: Document effective workflow and limitations**

Document recovery file handling, 15-minute stage TTL, session revocation, audit exclusion, rollback through a new prepare/commit and the continued absence of maintenance/full restore.

- [ ] **Step 2: Run focused selective restore tests**

```bash
node --experimental-strip-types --test tests/backup-selective-*.test.mjs tests/backup-restore-stage*.test.mjs tests/portal-schema-restore-stage.test.mjs
```

- [ ] **Step 3: Run lint/build/full suite**

```bash
npm run lint
npm run build
npm test
```

- [ ] **Step 4: Run Auth E2E**

Use the repository workflow and require Chromium RBAC/settings/FreeIPA/XYOps scenarios to remain green.

- [ ] **Step 5: Review complete diff**

Confirm no maintenance mode, audit replacement, dynamic SQL identifiers, stored backup payloads or secret-bearing audit metadata.

- [ ] **Step 6: Update PR body with exact head and test evidence**
