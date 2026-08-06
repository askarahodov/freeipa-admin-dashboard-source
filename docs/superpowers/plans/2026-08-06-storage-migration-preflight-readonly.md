# Read-only Storage Migration Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned admin-only read-only migration preflight that validates the applied canonical migration prefix, current-version backup, database quick check, and shared migration lock state without applying SQL or acquiring a lock.

**Architecture:** Extract the existing quick-check and migration-lock semantics into focused internal primitives, then build a single-flight preflight evaluator over the compile-time V3 registry. Expose the evaluator through the existing local-session/service-admin boundary, recovery gates, bounded audit, and a strict HTTP CLI. The future controlled-apply checkpoint will rerun this evaluator and atomically acquire the same internal lock immediately before mutation.

**Tech Stack:** TypeScript 5.9, Node.js 22 test runner, Cloudflare D1 prepared statements, Web Crypto, existing Worker composition, GitHub Actions CI/Auth E2E.

## Global Constraints

- Public route is exactly `POST /api/admin/storage/migrations/preflight`.
- Request body is exactly `{}` and encoded body size is at most 1 KiB.
- No request field may select SQL, migration, version, checksum, object, lock option, TTL, backup bypass, or force mode.
- Preflight must not create tables, apply migrations, acquire/delete/renew/release locks, repair drift, or modify domain data.
- The sole permitted side effect is the existing best-effort append-only audit event `storage.migration.preflight`.
- Local admin uses existing authenticated session and same-origin mutation checks.
- Non-local service admin uses the existing constant-time `ADMIN_TOKEN` check on the exact route.
- Viewer, operator, anonymous, and invalid token requests are denied before D1 access.
- Public data is limited to fixed codes, bounded counts/ages/versions, duration, and correlation ID.
- Never expose migration names, checksum values, SQL, object names, lock owner, database path, backup payload/metadata, actor input, credentials, headers, or raw exceptions.
- Default lock TTL is 60,000 ms and is bounded to 1,000–600,000 ms.
- Qualifying backup maximum age is 86,400,000 ms and lookup is bounded to 20 successful encrypted export audits.
- No pending migrations returns `not_required`; quick check, backup, and lock return explicit `not_required` states and perform no queries.
- A stale lock is reported but does not block; preflight never deletes it.
- No readiness/liveness, Docker HEALTHCHECK, Storage Center UI, migration apply, or destructive workflow changes.

---

## File Structure

**Create:**

- `storage-quick-check.ts` — one sanitized fixed `PRAGMA quick_check(1)` primitive without public endpoint codes.
- `db/portal-migration-lock.ts` — shared inspect/acquire/renew/release semantics for lock id `main`.
- `storage-migration-preflight-contract.ts` — versioned public types/path/fixed code unions.
- `storage-migration-preflight.ts` — read-only evaluator, journal/snapshot/backup/lock decisions, single-flight.
- `worker/storage-migration-preflight-entry.ts` — strict request, RBAC, audit, response mapping.
- `storage-migration-preflight-inspect-cli.ts` — strict parser/protocol validator/exit-code mapper.
- `scripts/storage-migration-preflight-inspect.ts` — executable CLI wrapper.
- `docs/STORAGE_MIGRATION_PREFLIGHT.md` — operator runbook.
- `tests/storage-quick-check.test.mjs`
- `tests/portal-migration-lock.test.mjs`
- `tests/storage-migration-preflight.test.mjs`
- `tests/storage-migration-preflight-api.test.mjs`
- `tests/storage-migration-preflight-routing-contract.test.mjs`
- `tests/storage-migration-preflight-inspect-cli.test.mjs`

**Modify:**

- `storage-integrity.ts` — consume shared quick-check primitive while preserving contract.
- `db/portal-migrations.ts` — export bounded journal/snapshot inspection helpers and consume shared lock module without behavior change.
- `db/portal-migrations-hardened.ts` — export the current canonical V3 registry under a stable read-only name.
- `worker/local-secure-entry.ts` — dispatch preflight through service/local admin boundaries.
- `admin-session-authorization.ts` — exact admin integration allowlist.
- `worker/schema-migrations-entry.ts` — schema-failure recovery allowlist.
- `worker/maintenance-mode-gate.ts` — maintenance recovery allowlist.
- `package.json` — `inspect:storage-migration-preflight` command.
- `README.md` — capability/CLI/runbook links.

---

### Task 1: Shared quick-check and migration-lock primitives

**Files:**
- Create: `storage-quick-check.ts`
- Create: `db/portal-migration-lock.ts`
- Modify: `storage-integrity.ts`
- Modify: `db/portal-migrations.ts`
- Test: `tests/storage-quick-check.test.mjs`
- Test: `tests/portal-migration-lock.test.mjs`
- Test: existing `tests/storage-integrity.test.mjs` and portal migration tests

**Interfaces:**
- Produces: `inspectStorageQuickCheck(query): Promise<{ state: "healthy" | "failed" | "unsupported" | "unavailable" }>`.
- Produces: `DEFAULT_MIGRATION_LOCK_TTL_MS`, `boundedMigrationLockTtl`, `inspectPortalMigrationLock`, `acquirePortalMigrationLock`, `renewPortalMigrationLock`, `releasePortalMigrationLock`.
- Lock inspection returns `{ state: "available" | "held" | "stale" | "unavailable"; blocking: boolean; ageMs: number | null; ttlMs: number }` and never returns owner.

- [ ] **Step 1: Write failing quick-check tests**

Cover exact `ok`, non-`ok`, unsupported pragma, query failure, one fixed SQL statement, and raw-output redaction. Import `inspectStorageQuickCheck` from the missing module so RED is an import failure.

- [ ] **Step 2: Write failing lock tests**

Cover no row, active row, exactly-at-TTL active boundary, stale row, malformed timestamp, query failure, TTL bounds, atomic stale cleanup + insert, owner-scoped renew/release, and same TTL semantics between inspect/acquire.

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --experimental-strip-types --test tests/storage-quick-check.test.mjs tests/portal-migration-lock.test.mjs
```

Expected: FAIL only because `storage-quick-check.ts` and `db/portal-migration-lock.ts` do not exist.

- [ ] **Step 4: Implement minimal primitives**

`storage-quick-check.ts` must issue only `PRAGMA quick_check(1)`, use only the first row value, compare normalized text to `ok`, classify unsupported errors internally, and discard all raw values/errors.

`db/portal-migration-lock.ts` must use only fixed statements for lock id `main`; read-only inspection selects only `acquired_at`. Acquisition may delete stale `main` and `INSERT OR IGNORE`; renew/release must bind owner and never expose it.

- [ ] **Step 5: Refactor existing consumers**

Map shared quick-check states back to existing `storage_quick_check_*` codes without changing `StorageIntegrityReport`. Replace private lock functions in `db/portal-migrations.ts` with the shared module while preserving attempts, delay, TTL, owner generation, busy status, renewal sequence, and release behavior.

- [ ] **Step 6: Run GREEN and regression tests**

```bash
node --experimental-strip-types --test tests/storage-quick-check.test.mjs tests/portal-migration-lock.test.mjs tests/storage-integrity.test.mjs tests/portal-migrations*.test.mjs
npm run lint
npm run build
```

Expected: all pass; existing storage integrity and startup migration tests remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add storage-quick-check.ts db/portal-migration-lock.ts storage-integrity.ts db/portal-migrations.ts tests/storage-quick-check.test.mjs tests/portal-migration-lock.test.mjs
git commit -m "refactor: share migration lock and quick check primitives"
```

---

### Task 2: Canonical read-only migration preflight evaluator

**Files:**
- Create: `storage-migration-preflight-contract.ts`
- Create: `storage-migration-preflight.ts`
- Modify: `db/portal-migrations.ts`
- Modify: `db/portal-migrations-hardened.ts`
- Test: `tests/storage-migration-preflight.test.mjs`

**Interfaces:**
- Produces: `STORAGE_MIGRATION_PREFLIGHT_PATH = "/api/admin/storage/migrations/preflight"`.
- Produces: `inspectStorageMigrationPreflight(env, dependencies?): Promise<StorageMigrationPreflightReport>`.
- Produces: exported read-only journal helpers and applied-prefix snapshot inspector from `db/portal-migrations.ts`.
- Uses: current V3 compile-time registry exported by `db/portal-migrations-hardened.ts`.

- [ ] **Step 1: Write failing evaluator tests**

Include fixtures for: one valid pending migration; no pending migrations with zero quick-check/backup/lock calls; journal gap/future/unknown/duplicate/malformed/name/checksum mismatch; applied-prefix structure valid; pending objects absent without false drift; partial future table/index/trigger; missing snapshot; quick check failed/unsupported/unavailable; full current-version backup ready; partial/duplicate/malformed/wrong-version/stale/missing/unavailable backup; lock available/held/exact TTL/stale/unavailable; deterministic decision priority; single-flight concurrent calls and no completed cache; bounded public values and forbidden-string redaction.

- [ ] **Step 2: Run RED evaluator test**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight.test.mjs
```

Expected: FAIL because contract/evaluator modules do not exist.

- [ ] **Step 3: Export read-only canonical helpers**

From `db/portal-migrations.ts`, expose typed bounded journal reading/validation and snapshot inspection without exposing mutating ensure/apply operations through the new evaluator. Add a pure cumulative snapshot merge that replaces same-name table/index/trigger definitions in version order.

From `db/portal-migrations-hardened.ts`, export the exact V3 registry used by hardened startup as `canonicalPortalMigrations`.

- [ ] **Step 4: Implement evaluator**

Use fixed D1 queries only. Read at most `registry.length + 1` journal rows; validate contiguous prefix, names, checksums, duplicates, and safe integers. Validate current applied-prefix snapshot and separately detect pending-owned objects already present. When pending count is zero, return `not_required` and explicit not-required subchecks without quick-check/backup/lock queries.

For pending migrations, run shared quick check, bounded backup audit lookup, and shared read-only lock inspection. A qualifying backup must match exact action/outcome/resource, current schema version, every `PORTAL_BACKUP_DOMAINS` value exactly once, and age <= 86,400,000 ms. Use fixed deterministic decision ordering from the spec.

- [ ] **Step 5: Add single-flight correctly**

Coalesce only evaluator work. Do not cache completed reports. Do not put request actor or correlation ID inside the shared evaluator promise.

- [ ] **Step 6: Run GREEN evaluator and migration regressions**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight.test.mjs tests/portal-migrations*.test.mjs tests/storage-integrity.test.mjs
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add storage-migration-preflight-contract.ts storage-migration-preflight.ts db/portal-migrations.ts db/portal-migrations-hardened.ts tests/storage-migration-preflight.test.mjs
git commit -m "feat: add read-only migration preflight evaluator"
```

---

### Task 3: HTTP request, RBAC, audit, and failure contract

**Files:**
- Create: `worker/storage-migration-preflight-entry.ts`
- Test: `tests/storage-migration-preflight-api.test.mjs`

**Interfaces:**
- Produces: `handleStorageMigrationPreflightRequest(request, env, dependencies?): Promise<Response | null>`.
- Consumes: `inspectStorageMigrationPreflight`, existing `encryptedBackupAccess`, `createAuditContext`, and `appendAuditEvent`.

- [ ] **Step 1: Write failing API tests**

Cover unrelated path, POST-only + `Allow`, 1 KiB body bound, malformed JSON, null/array/non-empty object/unknown field rejection, viewer/operator denial before evaluator/context/DB, healthy ready 200, not-required 200, blocked 200, unavailable 503, correlation ID body/header, no-store, bounded safe audit, audit failure tolerance, and full fixed unexpected unavailable report with no raw error.

- [ ] **Step 2: Run RED API test**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight-api.test.mjs
```

Expected: FAIL because handler module does not exist.

- [ ] **Step 3: Implement strict handler**

Authorize role before reading the body or invoking evaluator. Read request body once, enforce declared and actual UTF-8 byte size, accept only a plain object with zero keys, then create per-request audit context. Return exact report + correlation ID; map `unavailable` to 503 and every valid deterministic block to 200.

Unexpected failures must call a constructor that returns the complete versioned unavailable report with unavailable subchecks and bounded zeros; raw exceptions never enter response/audit.

- [ ] **Step 4: Run GREEN API tests**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight-api.test.mjs tests/storage-migration-preflight.test.mjs
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/storage-migration-preflight-entry.ts tests/storage-migration-preflight-api.test.mjs
git commit -m "feat: expose migration preflight API"
```

---

### Task 4: Runtime routing and recovery gates

**Files:**
- Modify: `admin-session-authorization.ts`
- Modify: `worker/local-secure-entry.ts`
- Modify: `worker/schema-migrations-entry.ts`
- Modify: `worker/maintenance-mode-gate.ts`
- Test: `tests/storage-migration-preflight-routing-contract.test.mjs`

**Interfaces:**
- Exact route participates in existing local admin and service-admin authorization composition.
- Recovery gates allow dispatch but never bypass authorization.

- [ ] **Step 1: Write failing routing source/behavior tests**

Assert exact import/dispatch/allowlist entries; non-local requests require service token before handler; local admin requires session and same origin; viewer/operator/anonymous never reach evaluator; schema failure and maintenance mode delegate the exact route; nearby subpaths are not allowlisted; scheduled and health/storage-status/storage-integrity composition remains unchanged.

- [ ] **Step 2: Run RED routing test**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight-routing-contract.test.mjs
```

Expected: FAIL only for missing preflight routing/allowlist integration.

- [ ] **Step 3: Add exact runtime integration**

Add path to `ADMIN_INTEGRATION_PATHS`, local/service dispatch beside integrity, schema recovery route set, and maintenance immediate allowlist. Preserve the order: authentication/session → same-origin/token → handler → existing runtime.

- [ ] **Step 4: Run GREEN routing and authorization regressions**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight-routing-contract.test.mjs tests/storage-integrity-routing-contract.test.mjs tests/admin-session-*.test.mjs tests/maintenance-*.test.mjs
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add admin-session-authorization.ts worker/local-secure-entry.ts worker/schema-migrations-entry.ts worker/maintenance-mode-gate.ts tests/storage-migration-preflight-routing-contract.test.mjs
git commit -m "feat: route migration preflight through admin recovery gates"
```

---

### Task 5: Strict HTTP CLI

**Files:**
- Create: `storage-migration-preflight-inspect-cli.ts`
- Create: `scripts/storage-migration-preflight-inspect.ts`
- Modify: `package.json`
- Test: `tests/storage-migration-preflight-inspect-cli.test.mjs`

**Interfaces:**
- Produces: `parseStorageMigrationPreflightInspectCli(argv, env)`.
- Produces: `runStorageMigrationPreflightInspectCli(options, dependencies?)`.
- npm command: `inspect:storage-migration-preflight`.

- [ ] **Step 1: Write failing CLI tests**

Cover default/root URL, bounded timeout, missing token, forbidden token/header/password/cookie/authorization arguments, unknown args, exact POST/body/headers/manual redirect, strict exact response keys, every state/decision/code combination, subcheck consistency, bounded counts/ages/versions/duration/correlation ID, auth, safe server failure, timeout/network, redirect, wrong media type, malformed JSON, extra fields, unsafe strings, and stdout/stderr secret/URL/raw-body redaction.

- [ ] **Step 2: Run RED CLI test**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight-inspect-cli.test.mjs
```

Expected: FAIL because CLI module does not exist.

- [ ] **Step 3: Implement parser and strict validator**

Read token only from `ADMIN_TOKEN`; accept only `PORTAL_URL`/`--url` and `--timeout-ms`. Validate exact contract keys and all state/code invariants. Output valid ready/not-required reports with exit 0; valid blocked/unavailable reports with exit 2; auth 3; network/timeout 4; protocol/argument 5. Never echo URL/token/redirect/raw body/exception.

- [ ] **Step 4: Add executable and package script**

The wrapper calls parser/runner, writes the returned streams, and sets `process.exitCode` without extra logging.

- [ ] **Step 5: Run GREEN CLI tests**

```bash
node --experimental-strip-types --test tests/storage-migration-preflight-inspect-cli.test.mjs
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add storage-migration-preflight-inspect-cli.ts scripts/storage-migration-preflight-inspect.ts package.json tests/storage-migration-preflight-inspect-cli.test.mjs
git commit -m "feat: add migration preflight inspection CLI"
```

---

### Task 6: Runbook, final review, exact-head verification, and checkpoint merge

**Files:**
- Create: `docs/STORAGE_MIGRATION_PREFLIGHT.md`
- Modify: `README.md`
- Modify: this plan checklist only if needed to record exact evidence in the PR body, not to claim unrun checks.

- [ ] **Step 1: Write operator runbook**

Document purpose, endpoint/CLI, state/exit interpretation, 24-hour full encrypted backup rule, stale versus held lock, operational responsibility to persist the downloaded backup externally, no-pending behavior, redaction, and explicit statement that preflight is advisory and does not acquire/apply/repair.

- [ ] **Step 2: Update README**

Add only the implemented capability, npm command, and runbook link. Do not claim controlled apply or Storage Center UI exists.

- [ ] **Step 3: Run complete local-equivalent verification through CI**

Push exact head and require:

```bash
npm run lint
npm run build
node --experimental-strip-types --test tests/*.test.mjs
```

Also require Auth E2E settings/schema contracts and Chromium authentication scenarios on the same SHA.

- [ ] **Step 4: Review complete diff**

Verify changed files are checkpoint-focused; no migration SQL/registry version, Dockerfile, health/readiness/liveness, UI, backup payload, or destructive operation changed. Search the diff for request-controlled SQL, `ensurePortalSchema` calls from preflight, lock mutation from preflight, raw errors, token logging, migration SQL/names/checksums in public output, and hidden force/override fields.

- [ ] **Step 5: Review PR feedback**

Confirm no unresolved review threads and no requested changes. Fix any actionable issue through a new RED/GREEN cycle and rerun exact-head verification.

- [ ] **Step 6: Merge with head protection**

Mark the draft PR ready only after all checks pass, then squash merge using the exact verified head SHA. Confirm the PR is merged and capture the merge commit.

- [ ] **Step 7: Update issue #44**

Post the merged checkpoint, endpoint/CLI, safety boundaries, exact-head CI/Auth E2E evidence, and remaining work. Keep #44 open for controlled migration apply and Storage Center UI.
