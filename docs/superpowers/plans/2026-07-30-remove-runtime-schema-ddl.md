# Runtime Schema DDL Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all schema-changing SQL from request and scheduled runtime paths so only the canonical migration lifecycle may create or alter portal schema objects.

**Architecture:** `db/portal-schema.ts`, immutable migration snapshots, and `db/portal-migrations.ts` remain the only owners of production DDL. Runtime persistence modules assume the outer `worker/schema-migrations-entry.ts` readiness boundary has already verified the schema and execute only data DML/queries. A source contract test prevents reintroducing DDL outside the approved migration files.

**Tech Stack:** TypeScript, Cloudflare Workers D1, Node test runner, GitHub Actions.

## Global Constraints

- Do not change canonical table/index/trigger definitions in this PR.
- Do not add destructive or data migrations.
- Preserve behavior when `DB` is absent in isolated unit-test paths.
- Production fetch and scheduled handlers remain blocked unless schema readiness is `ready`.
- Runtime application modules may use `SELECT`, `INSERT`, `UPDATE`, and `DELETE`, but not `CREATE`, `ALTER`, `DROP`, `REINDEX`, or schema-changing `PRAGMA`.

---

### Task 1: Add the runtime-DDL source contract

**Files:**
- Create: `tests/runtime-schema-ddl-boundary.test.mjs`
- Modify: `.github/workflows/auth-e2e.yml`

**Interfaces:**
- Consumes: production source paths and the approved migration-file allowlist.
- Produces: a regression contract that fails with the exact file and SQL keyword when runtime DDL is introduced.

- [ ] Write a test that recursively scans production `.ts` files while excluding `db/portal-schema.ts`, `db/portal-migration-v1.ts`, and `db/portal-migrations.ts`.
- [ ] Reject `CREATE TABLE`, `CREATE INDEX`, `CREATE UNIQUE INDEX`, `CREATE TRIGGER`, `ALTER TABLE`, `DROP TABLE`, `DROP INDEX`, `DROP TRIGGER`, and `REINDEX` case-insensitively.
- [ ] Add the test to focused Auth E2E schema contracts.
- [ ] Run the test before implementation and confirm it reports the current runtime owners.

### Task 2: Remove runtime DDL from the worker integration entry

**Files:**
- Modify: `worker/index.ts`
- Test: existing integration/settings/catalog/operation tests and `tests/runtime-schema-ddl-boundary.test.mjs`

**Interfaces:**
- Consumes: schema readiness guaranteed by `worker/schema-migrations-entry.ts`.
- Produces: operation-run, catalog snapshot/history, sync bookkeeping, and app-settings persistence that performs DML only.

- [ ] Delete local `CREATE TABLE`/`CREATE INDEX` constants and `ensure*Table` helpers.
- [ ] Remove every request-path call that executes those helpers.
- [ ] Preserve the existing `!env.DB` behavior and all DML statements unchanged.
- [ ] Run focused worker API and settings tests.

### Task 3: Remove runtime DDL from persistence modules

**Files:**
- Modify: `audit-log.ts`
- Modify: `run-replays.ts`
- Modify: `run-results.ts`
- Modify: `run-notifications.ts`
- Modify: `catalog-policies.ts`
- Modify: `approval-gates.ts`
- Modify: `process-presentation.ts`
- Modify: `local-auth.ts`
- Modify: settings revision/apply persistence modules identified by the source contract

**Interfaces:**
- Consumes: canonical schema readiness.
- Produces: persistence modules that execute only DML and reads.

- [ ] Delete duplicated schema SQL constants.
- [ ] Delete `ensure*` helpers whose only responsibility is schema creation.
- [ ] Remove calls to those helpers without changing authorization, encryption, validation, or data semantics.
- [ ] Run each module's existing tests after its edit.

### Task 4: Verify startup, empty database, and compatibility behavior

**Files:**
- Modify tests only where needed to express the migration/runtime ownership boundary.

**Interfaces:**
- Consumes: canonical migration lifecycle and DML-only runtime modules.
- Produces: evidence that an empty D1 is initialized before runtime delegation and that initialized databases work without request-time DDL.

- [ ] Verify empty-D1 bootstrap through the outer worker boundary.
- [ ] Verify direct runtime calls against an initialized D1 do not execute schema-changing SQL.
- [ ] Verify missing/incompatible schema remains blocked by readiness.
- [ ] Run full server suite, per-file matrix, lint, build, and Auth E2E.

### Task 5: Review and merge gate

**Files:**
- Modify: PR body and `docs/DATABASE_MIGRATIONS.md` if runtime ownership needs clarification.

**Interfaces:**
- Produces: a reviewable second PR for issue #57.

- [ ] Document that runtime handlers no longer self-heal schema.
- [ ] Request Codex review with the exact head SHA.
- [ ] Address all actionable review threads with regression tests.
- [ ] Merge only when exact-head CI and Auth E2E are successful and no unresolved actionable review remains.
