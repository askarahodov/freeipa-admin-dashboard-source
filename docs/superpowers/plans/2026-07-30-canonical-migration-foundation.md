# Canonical Migration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned canonical D1/SQLite migration baseline with safe adoption, checksum validation, drift/readiness enforcement and admin diagnostics as the first pull request of issue #57.

**Architecture:** `db/portal-schema.ts` owns the immutable schema inventory and SQL. `db/portal-migrations.ts` owns the migration journal, lock, adoption, validation and safe status model. `worker/schema-migrations-entry.ts` becomes the outer worker boundary and dispatches only after the schema is ready, while `worker/diagnostics-entry.ts` exposes the sanitized status to local administrators.

**Tech Stack:** TypeScript 5.9, Cloudflare D1/SQLite, Web Crypto SHA-256, Vinext/Vite worker entry, Node.js 22 test runner.

## Global Constraints

- Node.js must remain `>=22.13.0`.
- Automatic migrations are additive and forward-only; no `DROP`, destructive `ALTER`, data rewrite or secret decryption.
- `CONFIG_ENCRYPTION_KEY`, encrypted values, credentials, cookies, raw SQL and raw exception bodies must never appear in diagnostics, audit or tests.
- Existing lightweight D1 unit-test doubles without `batch()` must continue to work.
- Normal fetch and scheduled traffic must not reach application handlers when production D1 schema readiness is not `ready`.
- The first pull request is `Part of #57`; it does not close #57 or implement #37.

---

### Task 1: Canonical schema inventory

**Files:**
- Create: `db/portal-schema.ts`
- Test: `tests/portal-schema-inventory.test.mjs`

**Interfaces:**
- Produces: `portalSchemaTables`, `portalSchemaIndexes`, `portalSchemaTriggers`, `portalBaselineStatements`, `portalSchemaTableNames`.
- Consumes: no runtime modules; schema definitions are pure data.

- [ ] **Step 1: Write the failing inventory test**

Create a test that recursively scans `.ts` and `.mjs` source files, extracts `CREATE TABLE IF NOT EXISTS <name>`, and asserts every extracted runtime table exists in `portalSchemaTableNames`. It must also assert the migration infrastructure tables are present and that automatic baseline SQL contains no `DROP`, `DELETE`, `UPDATE`, `INSERT INTO` or destructive `ALTER TABLE` statements.

Run:

```bash
node --experimental-strip-types --test tests/portal-schema-inventory.test.mjs
```

Expected: FAIL because `db/portal-schema.ts` does not exist.

- [ ] **Step 2: Implement the canonical inventory**

Define exact current tables, columns, indexes and audit triggers. Export ordered baseline statements with table creation first, indexes second and triggers last.

- [ ] **Step 3: Run the inventory test**

Expected: PASS and report no runtime table absent from the baseline.

- [ ] **Step 4: Commit**

```bash
git add db/portal-schema.ts tests/portal-schema-inventory.test.mjs
git commit -m "feat: define canonical portal schema"
```

### Task 2: Migration journal, lock and drift validator

**Files:**
- Create: `db/portal-migrations.ts`
- Test: `tests/portal-schema-migrations.test.mjs`

**Interfaces:**
- Consumes: `portalBaselineStatements`, `portalSchemaTables`, `portalSchemaIndexes`, `portalSchemaTriggers`.
- Produces:
  - `type PortalSchemaState = "ready" | "busy" | "unavailable" | "incompatible" | "failed"`;
  - `type PortalSchemaStatus` with version, applied/pending, drift IDs, safe error code and verification timestamp;
  - `ensurePortalSchema(env, options?)`;
  - `inspectPortalSchema(env)`;
  - `publicPortalSchemaStatus(status)`;
  - `clearPortalSchemaCacheForTests()`.

- [ ] **Step 1: Write failing behavior tests**

Implement an in-memory D1 test double that supports `prepare`, `batch`, `sqlite_master`, `PRAGMA table_info`, `PRAGMA index_list`, migration rows and lock rows. Add tests for:

- empty database baseline creation;
- compatible existing database adoption without changing seeded rows;
- repeated idempotent startup;
- checksum mismatch;
- future version;
- missing required column/index/trigger;
- compatible extra table/column/index;
- failed DDL does not insert a journal row;
- lock contention returns `busy` and succeeds after stale lock expiry;
- public status excludes SQL, exception text and checksums.

Run:

```bash
node --experimental-strip-types --test tests/portal-schema-migrations.test.mjs
```

Expected: FAIL because migration exports do not exist.

- [ ] **Step 2: Implement migration infrastructure**

Create `portal_schema_migrations` and `portal_schema_lock`, calculate SHA-256 checksums, apply the baseline using `D1Database.batch`, validate objects before inserting the journal row, detect journal checksum/future-version errors, classify compatible/incompatible drift and release the lock best-effort.

- [ ] **Step 3: Add bounded concurrency and cache**

Retry an active non-stale lock for a bounded interval. Cache only successful readiness briefly per D1 object. Do not permanently cache failures.

- [ ] **Step 4: Run migration tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/portal-migrations.ts tests/portal-schema-migrations.test.mjs
git commit -m "feat: add portal migration journal and drift checks"
```

### Task 3: Startup/readiness worker boundary

**Files:**
- Create: `worker/schema-migrations-entry.ts`
- Modify: `vite.config.ts`
- Test: `tests/portal-schema-boundary.test.mjs`

**Interfaces:**
- Consumes: `ensurePortalSchema`, `publicPortalSchemaStatus`, existing `service-admin-root-entry`.
- Produces: outer Worker `fetch` and `scheduled` handlers; recovery endpoint `GET /api/schema/status`.

- [ ] **Step 1: Write the failing boundary contract**

Assert that Vite points to `schema-migrations-entry.ts`, the boundary imports `service-admin-root-entry`, normal requests delegate only after `state === "ready"`, scheduled execution is skipped when not ready, and the recovery endpoint requires constant-time `ADMIN_TOKEN` authorization.

Run:

```bash
node --experimental-strip-types --test tests/portal-schema-boundary.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Implement the outer boundary**

Use production migration execution only when `DB.batch` exists. Return safe HTTP 503 payloads for unavailable/busy/incompatible/failed states. Keep `/api/schema/status` available to a valid service-admin token and never include SQL or secrets.

- [ ] **Step 3: Update Vite entry and Auth E2E path filters**

Point `localBindingConfig.main` to the new boundary. Add `db/portal-schema.ts`, `db/portal-migrations.ts`, `worker/schema-migrations-entry.ts` and migration tests to `.github/workflows/e2e-auth.yml` paths and contract step.

- [ ] **Step 4: Run boundary contract**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/schema-migrations-entry.ts vite.config.ts .github/workflows/e2e-auth.yml tests/portal-schema-boundary.test.mjs
git commit -m "feat: enforce schema readiness before worker dispatch"
```

### Task 4: Admin diagnostics integration

**Files:**
- Modify: `worker/diagnostics-entry.ts`
- Test: `tests/local-diagnostics-schema.test.mjs`

**Interfaces:**
- Consumes: `inspectPortalSchema`, `publicPortalSchemaStatus`.
- Produces: `database.schema` in the existing `/api/auth/diagnostics` payload.

- [ ] **Step 1: Write the failing diagnostics contract**

Assert that diagnostics reads migration status, includes state/version/applied/pending/drift/error code, and omits SQL/checksum/credentials/encrypted fields.

- [ ] **Step 2: Implement diagnostics integration**

Fetch schema status without triggering another migration, sanitize it with `publicPortalSchemaStatus`, and include it under `database.schema` while preserving existing counts and RBAC.

- [ ] **Step 3: Run diagnostics tests**

```bash
node --experimental-strip-types --test tests/local-diagnostics-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add worker/diagnostics-entry.ts tests/local-diagnostics-schema.test.mjs
git commit -m "feat: expose safe schema diagnostics"
```

### Task 5: Operations documentation and roadmap

**Files:**
- Create: `docs/DATABASE_MIGRATIONS.md`
- Modify: `README.md`
- Modify: `docs/PRODUCT_ROADMAP.md`

**Interfaces:**
- Documents: ownership, startup states, adoption, drift diagnosis, forward-only policy, rollback and #37 dependency.

- [ ] **Step 1: Document operator behavior**

Include exact safe status endpoint, required service token, error codes, compatible versus incompatible drift, adoption behavior, rollback by application downgrade and prohibition on editing the migration journal.

- [ ] **Step 2: Update README and roadmap**

Link the migration document. Mark the foundation slice as implemented, #57 still in progress, and DDL cleanup as the next required slice before #37.

- [ ] **Step 3: Commit**

```bash
git add docs/DATABASE_MIGRATIONS.md README.md docs/PRODUCT_ROADMAP.md
git commit -m "docs: describe portal migration operations"
```

### Task 6: Full verification and PR

**Files:**
- Review all changed files.

**Interfaces:**
- Produces: reviewable PR `Part of #57` with evidence.

- [ ] **Step 1: Run focused contracts**

```bash
node --experimental-strip-types --test \
  tests/portal-schema-inventory.test.mjs \
  tests/portal-schema-migrations.test.mjs \
  tests/portal-schema-boundary.test.mjs \
  tests/local-diagnostics-schema.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run lint and production build**

```bash
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run full server matrix and Auth E2E**

```bash
npm test
npm run test:e2e:auth
```

Expected: PASS.

- [ ] **Step 4: Open PR**

Title: `Add canonical migration foundation`

Body must include threat model, schema/journal API, adoption behavior, drift classes, rollback, exact CI/Auth E2E runs and `Part of #57`.

- [ ] **Step 5: Request Codex review and address every actionable thread**

Merge only when exact-head CI/Auth E2E are green, all review threads are resolved and the PR remains mergeable.
