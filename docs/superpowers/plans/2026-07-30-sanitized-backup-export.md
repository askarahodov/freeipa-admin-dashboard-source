# Sanitized Backup Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-only, read-only sanitized backup export API that returns one deterministic payload per selected domain plus a validated versioned manifest.

**Architecture:** A small `backup-export.ts` orchestrator validates the request, invokes an exhaustive allowlisted registry of focused domain exporters, applies final recursive sanitization, creates deterministic manifest entries, and returns a complete document only after all domains succeed. A dedicated worker entry owns routing, existing auth/RBAC integration, normalized errors, response headers, and audit events; exporter modules never own authentication or mutation.

**Tech Stack:** TypeScript, Cloudflare Workers/D1, Web Crypto SHA-256, Node.js test runner, existing RBAC/audit/runtime migration boundary, GitHub Actions.

## Global Constraints

- Endpoint is exactly `POST /api/admin/backups/export`.
- Required role is `admin`; required permission is exactly `backup.export`.
- Request `domains` is required, non-empty, duplicate-free, and allowlisted by `PORTAL_BACKUP_DOMAINS`.
- Server uses fixed canonical domain order regardless of request order.
- Export is logical and read-only; no DML, DDL, upstream FreeIPA calls, or upstream XYOps calls.
- Use explicit SQL column lists; never use `SELECT *` in backup exporters.
- Exclude encrypted blobs, password hashes, session tokens, cookies, raw credentials, recovery material, and `CONFIG_ENCRYPTION_KEY`.
- Call `assertSanitizedBackupPayload` before `createBackupEntry` for every domain.
- No partial success document: any domain failure rejects the whole export.
- Response headers include `cache-control: no-store`, `content-type: application/json`, and `content-disposition: attachment`.
- Audit never stores payloads, checksums of secret-bearing data, credentials, cookies, raw SQL/database errors, or encryption material.
- No schema migration is required in this PR.

---

## File Structure

- Create `backup-export.ts`: request parsing, exporter interface/registry, orchestration, manifest assembly, error types.
- Create `backup-export-domains.ts`: focused D1 readers and sanitized mappers for all initial domains.
- Create `worker/backup-export-entry.ts`: route, authorization, body limit, normalized responses, headers, audit integration, delegation.
- Modify the current outer worker entry to delegate the new route through `worker/backup-export-entry.ts` without bypassing migration/auth boundaries.
- Modify the RBAC permission catalogue/default admin role to include `backup.export` while preserving custom mappings.
- Create `tests/backup-export-request.test.mjs`: parser/order/validation tests.
- Create `tests/backup-export-orchestrator.test.mjs`: manifest/payload/checksum/all-or-nothing tests.
- Create `tests/backup-export-domains.test.mjs`: one sanitized fixture per domain and explicit column behavior.
- Create `tests/backup-export-api.test.mjs`: authorization, headers, selected domains, safe errors, audit metadata.
- Create `tests/backup-export-source-contract.test.mjs`: reject mutation SQL, `SELECT *`, upstream fetch, and secret-bearing selected columns in exporter files.
- Modify relevant Auth E2E focused contract list only if the workflow does not already discover the new API/source tests.

---

### Task 1: Request Contract and Canonical Domain Ordering

**Files:**
- Create: `backup-export.ts`
- Create: `tests/backup-export-request.test.mjs`

**Interfaces:**
- Consumes: `PortalBackupDomain`, `PORTAL_BACKUP_DOMAINS` from `backup-manifest.ts`.
- Produces:
  - `class BackupExportError extends Error { code: string; status: number }`
  - `type BackupExportRequest = { domains: PortalBackupDomain[] }`
  - `function parseBackupExportRequest(value: unknown): BackupExportRequest`

- [ ] **Step 1: Write failing parser tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseBackupExportRequest } from "../backup-export.ts";

test("normalizes requested backup domains into canonical order", () => {
  assert.deepEqual(
    parseBackupExportRequest({ domains: ["audit", "settings", "catalog"] }),
    { domains: ["settings", "catalog", "audit"] },
  );
});

test("rejects empty, duplicate, unknown and extra request fields", () => {
  assert.throws(() => parseBackupExportRequest({ domains: [] }), /non-empty/);
  assert.throws(() => parseBackupExportRequest({ domains: ["settings", "settings"] }), /Duplicate/);
  assert.throws(() => parseBackupExportRequest({ domains: ["unknown"] }), /Unsupported/);
  assert.throws(() => parseBackupExportRequest({ domains: ["settings"], extra: true }), /Unknown request field/);
});
```

- [ ] **Step 2: Run test to verify red state**

Run: `node --experimental-strip-types --test tests/backup-export-request.test.mjs`
Expected: FAIL because `backup-export.ts` or `parseBackupExportRequest` does not exist.

- [ ] **Step 3: Implement the minimal parser**

```ts
export class BackupExportError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
  }
}

export function parseBackupExportRequest(value: unknown): BackupExportRequest {
  if (!plainObject(value)) throw new BackupExportError("backup_request_invalid", 400, "Backup export request must be an object");
  for (const key of Object.keys(value)) if (key !== "domains") throw new BackupExportError("backup_request_invalid", 400, `Unknown request field: ${key}`);
  if (!Array.isArray(value.domains) || value.domains.length === 0) throw new BackupExportError("backup_request_invalid", 400, "Backup domains must be a non-empty array");
  const requested = value.domains.map(String);
  if (new Set(requested).size !== requested.length) throw new BackupExportError("backup_request_invalid", 400, "Duplicate backup domains");
  for (const domain of requested) if (!PORTAL_BACKUP_DOMAINS.includes(domain as PortalBackupDomain)) throw new BackupExportError("backup_request_invalid", 400, `Unsupported backup domain: ${domain}`);
  return { domains: PORTAL_BACKUP_DOMAINS.filter((domain) => requested.includes(domain)) };
}
```

- [ ] **Step 4: Run parser tests**

Run: `node --experimental-strip-types --test tests/backup-export-request.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backup-export.ts tests/backup-export-request.test.mjs
git commit -m "feat: add backup export request contract"
```

---

### Task 2: Exporter Interface and All-or-Nothing Orchestration

**Files:**
- Modify: `backup-export.ts`
- Create: `tests/backup-export-orchestrator.test.mjs`

**Interfaces:**
- Consumes: `createBackupEntry`, `validateBackupManifest`, `assertSanitizedBackupPayload`, manifest constants from `backup-manifest.ts`.
- Produces:
  - `type BackupExportEnv = { DB?: D1Database }`
  - `type PortalBackupDomainExporter = { domain: PortalBackupDomain; path: \`domains/${string}.json\`; export(env: BackupExportEnv): Promise<{ payload: unknown; records: number }> }`
  - `type SanitizedBackupDocument = { manifest: PortalBackupManifest; payloads: Record<string, unknown>; summary: { entries: number; records: number; bytes: number } }`
  - `async function exportSanitizedBackup(env, options, registry): Promise<SanitizedBackupDocument>`

- [ ] **Step 1: Write failing orchestration tests**

Test deterministic exporter invocation order, path/manifest bijection, matching canonical bytes/checksums, absent DB error, and a registry where the second exporter throws. Assert the thrown case returns no document and does not invoke later exporters.

- [ ] **Step 2: Run orchestration tests to verify red state**

Run: `node --experimental-strip-types --test tests/backup-export-orchestrator.test.mjs`
Expected: FAIL because orchestration interfaces are missing.

- [ ] **Step 3: Implement minimal orchestration**

Implementation requirements:

```ts
if (!env.DB) throw new BackupExportError("backup_database_unavailable", 503, "Backup database is unavailable");
const payloads: Record<string, unknown> = {};
const entries: PortalBackupEntry[] = [];
for (const domain of options.domains) {
  const exporter = registry.get(domain);
  if (!exporter) throw new BackupExportError("backup_schema_incompatible", 409, `Backup domain is unavailable: ${domain}`);
  const result = await exporter.export(env);
  assertSanitizedBackupPayload(result.payload);
  const entry = await createBackupEntry({ domain, path: exporter.path, payload: result.payload, records: result.records });
  entries.push(entry);
  payloads[exporter.path] = result.payload;
}
```

Assemble one `createdAt`, current canonical schema version, `mode: "sanitized"`, `encryption: null`, validate via `validateBackupManifest`, and calculate summary from entries.

- [ ] **Step 4: Run orchestration tests**

Run: `node --experimental-strip-types --test tests/backup-export-orchestrator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backup-export.ts tests/backup-export-orchestrator.test.mjs
git commit -m "feat: orchestrate sanitized backup exports"
```

---

### Task 3: Focused Sanitized Domain Exporters

**Files:**
- Create: `backup-export-domains.ts`
- Create: `tests/backup-export-domains.test.mjs`

**Interfaces:**
- Consumes: `BackupExportEnv`, `PortalBackupDomainExporter` from `backup-export.ts`.
- Produces: `SANITIZED_BACKUP_EXPORTERS: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>` exhaustive for `PORTAL_BACKUP_DOMAINS`.

- [ ] **Step 1: Write failing domain fixture tests**

For each domain, provide a fake D1 fixture and assert stable payload shape/order:

- `settings`: `config_json`, `updated_at`; parse config and remove secret values/secret flags that expose values.
- `local-auth`: identity/display/status/role/timestamps; no hash/session/reset columns.
- `rbac`: normalized assignments/permission metadata only.
- `policies`: visibility, approval and presentation policy documents using explicit safe fields.
- `catalog`: snapshot/history metadata and sanitized catalog data; no upstream credentials/raw errors.
- `operations`: run identity/status/timing/job metadata and sanitized result summary only.
- `approvals`: approval/decision actor/status/expiry/sanitized summary; no execution secrets.
- `audit`: existing sanitized append-only event fields.

Assert each result passes `assertSanitizedBackupPayload` and arrays are explicitly ordered.

- [ ] **Step 2: Run domain tests to verify red state**

Run: `node --experimental-strip-types --test tests/backup-export-domains.test.mjs`
Expected: FAIL because exporter registry is missing.

- [ ] **Step 3: Implement explicit read-only exporters**

Rules for every SQL statement:

```sql
SELECT explicit_column_a, explicit_column_b
FROM explicit_table
ORDER BY stable_column_a, stable_column_b
```

Do not use `SELECT *`. Do not select encrypted/password/session/token columns and then remove them later. Wrap missing-table/schema errors as `BackupExportError("backup_schema_incompatible", 409, "Backup schema is incompatible")` without exposing raw SQL errors.

- [ ] **Step 4: Run domain tests**

Run: `node --experimental-strip-types --test tests/backup-export-domains.test.mjs`
Expected: PASS for all eight domains.

- [ ] **Step 5: Commit**

```bash
git add backup-export-domains.ts tests/backup-export-domains.test.mjs
git commit -m "feat: add sanitized backup domain exporters"
```

---

### Task 4: Source Security Contract

**Files:**
- Create: `tests/backup-export-source-contract.test.mjs`

**Interfaces:**
- Consumes: source files `backup-export.ts`, `backup-export-domains.ts`, `worker/backup-export-entry.ts` when present.
- Produces: CI guard against future unsafe exporter changes.

- [ ] **Step 1: Write the source contract**

The test reads exporter source and rejects:

```js
assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX)\b/i);
assert.doesNotMatch(source, /SELECT\s+\*/i);
assert.doesNotMatch(source, /\bfetch\s*\(/);
assert.doesNotMatch(source, /config_encryption_key|encrypted_secrets|password_hash|session_token|reset_token/i);
```

Allow the route entry to call audit persistence, but scan `backup-export-domains.ts` strictly for read-only behavior.

- [ ] **Step 2: Run source contract**

Run: `node --experimental-strip-types --test tests/backup-export-source-contract.test.mjs`
Expected: PASS only when domain exporters contain no prohibited source patterns.

- [ ] **Step 3: Commit**

```bash
git add tests/backup-export-source-contract.test.mjs
git commit -m "test: guard sanitized backup exporter sources"
```

---

### Task 5: RBAC Permission Integration

**Files:**
- Modify: the existing permission catalogue/default-role source identified by repository search for `settings.manage` and admin defaults.
- Test: create or modify the nearest RBAC contract test.

**Interfaces:**
- Produces permission `backup.export` for default admin only.

- [ ] **Step 1: Write failing RBAC tests**

Assert:

```js
assert.equal(adminPermissions.includes("backup.export"), true);
assert.equal(operatorPermissions.includes("backup.export"), false);
assert.equal(viewerPermissions.includes("backup.export"), false);
```

Also assert existing custom `PORTAL_RBAC_JSON` mappings preserve explicitly configured roles and do not gain permissions outside their role.

- [ ] **Step 2: Run the focused RBAC test**

Expected: FAIL because `backup.export` is absent.

- [ ] **Step 3: Add permission without changing unrelated role semantics**

Add exactly one permission catalogue entry and include it in the default admin permission set only.

- [ ] **Step 4: Run focused RBAC tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <rbac-files> <rbac-tests>
git commit -m "feat: add backup export permission"
```

---

### Task 6: Protected API Route, Safe Errors, Headers and Audit

**Files:**
- Create: `worker/backup-export-entry.ts`
- Modify: current outer worker entry to delegate the route after migration boundary.
- Create: `tests/backup-export-api.test.mjs`

**Interfaces:**
- Consumes: existing secure runtime/admin identity helpers, `parseBackupExportRequest`, `exportSanitizedBackup`, `SANITIZED_BACKUP_EXPORTERS`, `appendAuditEvent`.
- Produces: `POST /api/admin/backups/export`.

- [ ] **Step 1: Write failing API tests**

Cover:

- unauthenticated returns existing 401 contract;
- viewer/operator return 403;
- admin lacking permission returns 403;
- admin with permission receives only selected domains;
- request body over fixed limit returns `413 backup_request_too_large` before parse;
- malformed/extra/duplicate/unknown domains return `400 backup_request_invalid`;
- absent D1 returns `503 backup_database_unavailable`;
- schema exporter failure returns `409 backup_schema_incompatible` with no payload;
- unexpected error returns `500 backup_export_failed` without stack/raw error;
- success headers include no-store and attachment filename;
- success/failure audit metadata contains domains/counts/duration/code but no payloads or credentials.

- [ ] **Step 2: Run API tests to verify red state**

Run: `node --experimental-strip-types --test tests/backup-export-api.test.mjs`
Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route entry**

Request flow:

1. Match method/path exactly.
2. Resolve existing authenticated actor and role.
3. Require `backup.export` before querying D1.
4. Enforce fixed body byte limit before `JSON.parse`.
5. Parse request and export all selected domains.
6. Append sanitized success or failure audit event.
7. Return the complete document only on success.

Response headers:

```ts
{
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "content-disposition": `attachment; filename="portal-backup-${createdAt.slice(0, 10)}.json"`,
}
```

- [ ] **Step 4: Run API tests**

Run: `node --experimental-strip-types --test tests/backup-export-api.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/backup-export-entry.ts <outer-entry> tests/backup-export-api.test.mjs
git commit -m "feat: expose sanitized backup export API"
```

---

### Task 7: Full Regression Verification and PR Evidence

**Files:**
- Modify: PR body/checklist only if needed.
- Modify: Auth E2E workflow focused tests only if the new files are not auto-discovered.

**Interfaces:**
- Produces: review-ready PR with fresh evidence.

- [ ] **Step 1: Run all focused backup tests**

```bash
node --experimental-strip-types --test \
  tests/backup-manifest.test.mjs \
  tests/backup-manifest-security-cases.test.mjs \
  tests/backup-export-request.test.mjs \
  tests/backup-export-orchestrator.test.mjs \
  tests/backup-export-domains.test.mjs \
  tests/backup-export-source-contract.test.mjs \
  tests/backup-export-api.test.mjs
```

Expected: all pass, zero failures.

- [ ] **Step 2: Run repository verification**

```bash
npm run lint
npm run build
npm test
```

Expected: exit code 0 for every command.

- [ ] **Step 3: Verify exact source invariants**

Search exporter modules for mutation SQL, `SELECT *`, upstream fetch, and forbidden secret column names. Expected: no matches.

- [ ] **Step 4: Verify GitHub Actions**

CI and relevant Auth E2E must complete successfully on the exact final head SHA.

- [ ] **Step 5: Final review gate**

Confirm no unresolved review threads, no temporary workflow files, unchanged head SHA, and mergeability before changing draft status or merging.
