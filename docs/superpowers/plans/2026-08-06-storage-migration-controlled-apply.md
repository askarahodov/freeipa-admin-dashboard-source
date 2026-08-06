# Controlled Storage Migration Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-controlled, maintenance-gated workflow for applying future canonical portal migrations while preserving automatic clean-install bootstrap.

**Architecture:** Canonical migrations gain an explicit `mode` and remain an automatic contiguous prefix followed by an optional controlled suffix. Startup applies only automatic migrations and reports controlled pending work without mutating it. A separate operation repository and apply engine acquire the shared lock, rerun the complete preflight under that lease, persist bounded operation/audit evidence, apply the compile-time controlled suffix, and expose strict apply/status/reconcile APIs and CLIs.

**Tech Stack:** TypeScript 5.9, Node.js 22 built-in test runner, Cloudflare D1/SQLite prepared statements and `batch`, existing Worker routing, maintenance controller, audit log, migration registry, quick-check, and GitHub Actions CI/Auth E2E.

## Global Constraints

- No arbitrary SQL, uploaded migration file, target version, subset selection, force, bypass, rollback, restore, or automatic partial-migration continuation.
- Versions 1–4 are production `automatic`; production contains no controlled version 5 in this checkpoint.
- Automatic migrations must form a strict contiguous prefix; every migration after the first `controlled` migration must also be `controlled`.
- Apply requires active maintenance, matching maintenance operation/controller secret, mandatory start audit, owner-scoped lock, and a fresh safety decision recomputed under that lock.
- Public output and audit must not contain SQL, migration names/checksums, object names, raw drift, raw errors, lock owner, database path, backup metadata, actor credentials, request headers, or controller secret.
- Request bodies are strictly shaped and bounded; response cardinality and numeric fields are bounded.
- Apply is synchronous in this checkpoint; no background job, queue, webhook, or polling worker.
- Maintenance never exits automatically after success or failure.
- Every behavior change follows RED → GREEN → regression verification and a focused commit.

---

## File Map

**Create**

- `db/portal-migration-v4.ts` — fixed SQL and canonical snapshot for `portal_migration_operations`.
- `db/portal-migrations-v4.ts` — production v4 registry and hardened ensure/inspect wrappers.
- `storage-migration-operation.ts` — safe operation states, projections, confirmation, and fixed failure codes.
- `storage-migration-operation-repository.ts` — bounded single-row D1 reads and owner-independent operation transitions.
- `storage-migration-apply-contract.ts` — exact paths and versioned public contracts.
- `storage-migration-apply.ts` — controlled apply and read-only reconcile engine.
- `worker/storage-migration-apply-entry.ts` — apply/status/reconcile HTTP handler.
- `storage-migration-apply-cli.ts` and `scripts/storage-migration-apply.ts` — strict HTTP CLI.
- `docs/STORAGE_MIGRATION_CONTROLLED_APPLY.md` — operator runbook.
- focused tests listed in each task.

**Modify**

- `db/portal-migrations.ts` — migration mode, registry validation, automatic-only startup application, public `pending` state, reusable apply primitive.
- `db/portal-migrations-v2.ts`, `db/portal-migrations-v3.ts` — mark existing migrations automatic without changing checksum material.
- `db/portal-migrations-hardened.ts` — use v4 registry and preserve additional drift checks.
- `storage-migration-preflight.ts` — use v4 registry and expose under-lock evaluator dependency without lock inspection race.
- `maintenance-mode.ts`, `maintenance-repository.ts` — fixed migration failure transition callable only by internal engine.
- `worker/local-secure-entry.ts`, `worker/schema-migrations-entry.ts`, `worker/maintenance-mode-gate.ts` — exact routing and gate allowlists.
- health/readiness files discovered by existing schema tests — project `schema_migration_pending` without making liveness fail.
- `package.json`, `README.md`, roadmap/operations docs.

---

### Task 1: Migration Mode Contract and Registry Invariants

**Files:**
- Modify: `db/portal-migrations.ts`
- Modify: `db/portal-migrations-v2.ts`
- Modify: `db/portal-migrations-v3.ts`
- Test: `tests/portal-migration-mode.test.mjs`
- Test: `tests/portal-migration-registry-invariants.test.mjs`

**Interfaces:**
- Produces: `type PortalMigrationMode = "automatic" | "controlled"`.
- Produces: `PortalMigration.mode`.
- Produces: `validatePortalMigrationRegistry(registry): { automatic: readonly PortalMigration[]; controlled: readonly PortalMigration[] }` or a fixed internal error.
- Produces: `automaticPendingMigrations(registry, appliedVersions)` and `controlledPendingMigrations(registry, appliedVersions)`.

- [ ] **Step 1: Write RED mode/invariant tests**

Cover exact contiguous versions, automatic prefix, rejection of automatic-after-controlled, controlled snapshot requirement, unchanged checksum material, and versions 1–3 marked automatic.

```js
assert.deepEqual(validatePortalMigrationRegistry([
  migration(1, "automatic"),
  migration(2, "controlled"),
]).controlled.map((item) => item.version), [2]);
assert.throws(() => validatePortalMigrationRegistry([
  migration(1, "controlled"),
  migration(2, "automatic"),
]), /migration_registry_invalid/);
```

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/portal-migration-mode.test.mjs tests/portal-migration-registry-invariants.test.mjs`
Expected: FAIL because `mode` and registry validator do not exist.

- [ ] **Step 3: Implement the minimal registry contract**

Add `mode` metadata without changing `checksum(version, name, statements)`. Validate the registry before any journal query or SQL mutation. Mark baseline, v2, and v3 migrations `automatic`.

- [ ] **Step 4: Run focused and existing migration tests**

Run: `node --experimental-strip-types --test tests/portal-migration-mode.test.mjs tests/portal-migration-registry-invariants.test.mjs tests/portal-migrations*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add migration application modes`

---

### Task 2: Automatic Foundation Migration Version 4

**Files:**
- Create: `db/portal-migration-v4.ts`
- Create: `db/portal-migrations-v4.ts`
- Modify: `db/portal-migrations-hardened.ts`
- Test: `tests/portal-migration-v4.test.mjs`
- Test: `tests/portal-migrations-v4.test.mjs`

**Interfaces:**
- Produces: `portalMigrationOperationsTable` canonical table definition.
- Produces: `portalMigrationV4Statements`, `portalMigrationV4TableStatements`, `portalMigrationV4SecondaryStatements`.
- Produces: `portalMigrationsV4`, `ensurePortalSchemaV4`, `inspectPortalSchemaV4`.

- [ ] **Step 1: Write RED schema tests**

Assert one `id = "main"` operation row model, exact columns, allowed stored states, no actor/secret/SQL/checksum fields, and v4 mode `automatic`.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/portal-migration-v4.test.mjs tests/portal-migrations-v4.test.mjs`
Expected: FAIL because v4 modules do not exist.

- [ ] **Step 3: Implement v4 SQL and registry**

Create the bounded table with `CHECK` constraints for `id`, versions/counts, state, and nullable timestamps/failure code. Keep checksum material `{ version: 4, name: "controlled-migration-foundation", statements }`.

- [ ] **Step 4: Point hardened runtime at v4 and verify**

Run: `node --experimental-strip-types --test tests/portal-migration-v4.test.mjs tests/portal-migrations-v4.test.mjs tests/portal-migrations-hardened*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add controlled migration foundation schema`

---

### Task 3: Startup Stops Before Controlled Migrations

**Files:**
- Modify: `db/portal-migrations.ts`
- Modify: `db/portal-migrations-v4.ts`
- Modify: `db/portal-migrations-hardened.ts`
- Modify: schema status/health projection files located by `schema_migration_pending`
- Test: `tests/portal-controlled-startup.test.mjs`
- Test: `tests/schema-migration-pending-contract.test.mjs`
- Test: existing schema/health/readiness suites

**Interfaces:**
- Extends: `PortalSchemaState` with `pending`.
- Produces: fixed `errorCode: "schema_migration_pending"` when a valid controlled suffix exists.
- Produces: `applyPortalMigrationWithLease(db, migration, owner, registry, options)` reusable only by startup automatic prefix and controlled engine.

- [ ] **Step 1: Write RED startup tests**

Inject registry `[automatic v1, controlled v2]`; prove `ensurePortalSchemaWithRegistry` applies v1, never prepares v2 SQL, and returns `pending` with current/latest/pending versions. Add tests that invalid registry fails before DB mutation.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/portal-controlled-startup.test.mjs tests/schema-migration-pending-contract.test.mjs`
Expected: FAIL because startup applies all pending migrations and `pending` is unknown.

- [ ] **Step 3: Split automatic and controlled execution**

Use validated registry partitions. Startup acquires the existing lock only when automatic work exists. It applies the automatic prefix, re-inspects, and returns `pending` when the next unapplied migration is controlled. Export the owner-lease apply primitive without exporting raw request-controlled SQL execution.

- [ ] **Step 4: Integrate health/readiness semantics**

Project `schema_migration_pending` as not-ready for normal traffic and scheduled work; keep liveness alive. Preserve recovery routes for storage/maintenance/apply.

- [ ] **Step 5: Run complete schema/health regression subset**

Run: `node --experimental-strip-types --test tests/portal-controlled-startup.test.mjs tests/schema-migration-pending-contract.test.mjs tests/*schema*.test.mjs tests/*health*.test.mjs tests/*readiness*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: stop startup before controlled migrations`

---

### Task 4: Operation Contract and Repository

**Files:**
- Create: `storage-migration-operation.ts`
- Create: `storage-migration-operation-repository.ts`
- Modify: `maintenance-mode.ts`
- Modify: `maintenance-repository.ts`
- Test: `tests/storage-migration-operation.test.mjs`
- Test: `tests/storage-migration-operation-repository.test.mjs`
- Test: `tests/maintenance-migration-failure.test.mjs`

**Interfaces:**
- Produces: stored states `running | succeeded | failed | interrupted | reconciled` and public `idle`.
- Produces: `createMigrationOperationId(): string` matching `migration_<uuid>`.
- Produces: `migrationApplyConfirmation(operationId, fromVersion, targetVersion): string` equal to `APPLY:<maintenanceOperationId>:<from>:<target>`.
- Produces: `loadMigrationOperation`, `beginMigrationOperation`, `recordMigrationProgress`, `completeMigrationOperation`, `failMigrationOperation`, `markMigrationInterrupted`, `markMigrationReconciled`.
- Produces: `failMaintenanceForMigration(db, maintenanceOperationId, failureCode, now)` with fixed safe codes only.

- [ ] **Step 1: Write RED pure/repository tests**

Cover malformed rows, bounded counts/timestamps, exact state transitions, stale/terminal conflict rejection, fixed failure-code allowlist, and absence of secrets/raw internals in projection.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/storage-migration-operation.test.mjs tests/storage-migration-operation-repository.test.mjs tests/maintenance-migration-failure.test.mjs`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement exact single-row repository statements**

Every mutating statement must include expected current state and operation ID. `begin` inserts/replaces only from no active row or an explicitly reconciled/interrupted terminal row. Terminal success/failure methods accept prepared audit statements for one D1 batch.

- [ ] **Step 4: Implement internal maintenance failure transition**

Allow only migration engine fixed codes; never accept request data. Keep maintenance non-inactive and `recoveryRequired` after failure.

- [ ] **Step 5: Run focused and maintenance regressions**

Run: `node --experimental-strip-types --test tests/storage-migration-operation*.test.mjs tests/maintenance-migration-failure.test.mjs tests/maintenance-*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add migration operation persistence`

---

### Task 5: Controlled Apply and Reconcile Engine

**Files:**
- Create: `storage-migration-apply-contract.ts`
- Create: `storage-migration-apply.ts`
- Modify: `storage-migration-preflight.ts`
- Test: `tests/storage-migration-apply.test.mjs`
- Test: `tests/storage-migration-apply-failures.test.mjs`
- Test: `tests/storage-migration-reconcile.test.mjs`

**Interfaces:**
- Produces: `applyControlledStorageMigrations(env, context, input, dependencies)`.
- Produces: `inspectMigrationApplyStatus(env)`.
- Produces: `reconcileControlledStorageMigration(env, context, input, dependencies)`.
- Consumes: active maintenance row/controller verification, v4 registry, shared lock, under-lock preflight, reusable migration apply primitive, operation repository, quick check, canonical inspect, prepared audit statements.

- [ ] **Step 1: Write RED happy-path tests**

Inject one controlled migration. Assert strict order: maintenance verify → mandatory start audit preparation → lock acquire → under-lock preflight → running row/start audit batch → migration/journal → progress/audit batch → final schema/quick-check → success/completion audit batch → owner release.

- [ ] **Step 2: Write RED failure-injection tests**

Cover missing backup, held lock, stale lock reclaim, lock renewal loss, journal race after lock, start audit failure before SQL, migration batch failure, progress persistence failure, final quick-check failure, final audit failure, and release failure. Prove no raw error leaks and maintenance remains recovery-required after any post-start failure.

- [ ] **Step 3: Write RED reconcile tests**

Cover idle, active lock conflict, no journal/object progress → interrupted, fully valid target → reconciled, partial/future objects or journal inconsistency → failed, and proof reconcile executes no migration SQL.

- [ ] **Step 4: Run RED tests**

Run: `node --experimental-strip-types --test tests/storage-migration-apply.test.mjs tests/storage-migration-apply-failures.test.mjs tests/storage-migration-reconcile.test.mjs`
Expected: FAIL because engine is absent.

- [ ] **Step 5: Implement under-lock safety evaluation**

Refactor preflight internals so apply can validate journal/applied-prefix/partial future/integrity/backup after acquiring the owner lease while omitting the public lock inspection decision. The public preflight behavior and contract remain unchanged.

- [ ] **Step 6: Implement synchronous engine and reconciliation**

Use only compile-time controlled suffix. Never coalesce apply requests. Keep one request-local in-flight execution; concurrency is rejected by lock/operation state. Batch operation/audit transitions as specified.

- [ ] **Step 7: Run focused plus preflight/lock regressions**

Run: `node --experimental-strip-types --test tests/storage-migration-apply*.test.mjs tests/storage-migration-reconcile.test.mjs tests/storage-migration-preflight*.test.mjs tests/portal-migration-lock.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

Commit message: `feat: add controlled migration apply engine`

---

### Task 6: HTTP API, Authorization, and Recovery Routing

**Files:**
- Create: `worker/storage-migration-apply-entry.ts`
- Modify: `worker/local-secure-entry.ts`
- Modify: `worker/schema-migrations-entry.ts`
- Modify: `worker/maintenance-mode-gate.ts`
- Test: `tests/storage-migration-apply-api.test.mjs`
- Test: `tests/storage-migration-apply-routing-contract.test.mjs`

**Interfaces:**
- Paths: `/api/admin/storage/migrations/apply`, `/api/admin/storage/migrations/apply/status`, `/api/admin/storage/migrations/apply/reconcile`.
- Apply/reconcile bodies have exact keys from the spec; status is GET-only.
- Response includes fixed safe state, versions/counts/timestamps/failure code, `recoveryRequired`, and correlation ID.

- [ ] **Step 1: Write RED API tests**

Cover exact path/method, bounded streaming body, unknown fields, viewer/operator denial before body/DB, local same-origin, service token, maintenance controller mismatch, status read, safe HTTP mappings, no-store/correlation, and best-effort denied/failure audit without secret capture.

- [ ] **Step 2: Write RED routing tests**

Prove exact routes are reachable through schema-pending/failure and maintenance gates while authorization remains mandatory. Near-match subpaths must not be allowlisted. Normal APIs and scheduled work stay blocked while schema is pending or maintenance active.

- [ ] **Step 3: Run RED tests**

Run: `node --experimental-strip-types --test tests/storage-migration-apply-api.test.mjs tests/storage-migration-apply-routing-contract.test.mjs`
Expected: FAIL because handler/routes do not exist.

- [ ] **Step 4: Implement handler and routing**

Reuse bounded stream parsing pattern from preflight, existing local/service admin delegation, and maintenance controller verification. Never pass raw request objects into engine/audit metadata.

- [ ] **Step 5: Run API/routing regression subset**

Run: `node --experimental-strip-types --test tests/storage-migration-apply-api.test.mjs tests/storage-migration-apply-routing-contract.test.mjs tests/storage-migration-preflight-api.test.mjs tests/storage-migration-preflight-routing-contract.test.mjs tests/maintenance-*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: expose controlled migration apply API`

---

### Task 7: Strict Apply and Reconcile CLI

**Files:**
- Create: `storage-migration-apply-cli.ts`
- Create: `scripts/storage-migration-apply.ts`
- Modify: `package.json`
- Test: `tests/storage-migration-apply-cli.test.mjs`

**Interfaces:**
- Commands: `npm run apply:storage-migrations -- apply`, `status`, `reconcile`.
- Secrets only from environment; CLI arguments may contain only action, root URL, timeout, operation ID, versions, and confirmation source required by the contract.
- Exit codes: `0 success/no work`, `2 blocked/recovery required`, `3 auth`, `4 network/timeout`, `5 arguments/protocol/unsafe response`.

- [ ] **Step 1: Write RED CLI tests**

Cover root URL validation, redirect disable, content type/status/contract validation, token/controller-secret argument rejection, safe JSON output, and all exit codes.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/storage-migration-apply-cli.test.mjs`
Expected: FAIL because CLI is absent.

- [ ] **Step 3: Implement strict validator and wrapper**

Use the HTTP API only. Do not print URL, headers, redirects, raw body, raw exception, tokens, controller secret, SQL, or internal identifiers. Print only validated public contract JSON.

- [ ] **Step 4: Run CLI and package regression tests**

Run: `node --experimental-strip-types --test tests/storage-migration-apply-cli.test.mjs tests/storage-migration-preflight-inspect-cli*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add controlled migration apply CLI`

---

### Task 8: Documentation and Roadmap

**Files:**
- Create: `docs/STORAGE_MIGRATION_CONTROLLED_APPLY.md`
- Modify: `README.md`
- Modify: relevant operations/roadmap docs
- Test: `tests/storage-migration-apply-docs.test.mjs`

- [ ] **Step 1: Write RED documentation contract**

Assert route names, maintenance sequence, backup responsibility, exit codes, recovery matrix, no automatic resume, no rollback, no UI, and warning that preflight is rerun under lock.

- [ ] **Step 2: Run RED docs test**

Run: `node --experimental-strip-types --test tests/storage-migration-apply-docs.test.mjs`
Expected: FAIL until runbook exists.

- [ ] **Step 3: Write operator runbook**

Document prepare → enter → preflight → apply → status → verification → exit → complete, plus reconcile/restore escalation. State that backup audit proves export generation, not durable external storage.

- [ ] **Step 4: Run docs test**

Run: `node --experimental-strip-types --test tests/storage-migration-apply-docs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `docs: document controlled migration apply`

---

### Task 9: Security Review, Exact-Head Verification, PR, and Merge

**Files:**
- Review every changed file; no new implementation unless a verified defect is found.

- [ ] **Step 1: Run focused security searches**

Verify no request-controlled SQL/identifiers, no controller secret in audit/response/logs, no lock owner projection, no force/bypass/target selection, no automatic controlled apply, and no maintenance auto-exit.

- [ ] **Step 2: Run full local-equivalent checks through CI**

Required exact-head evidence:

```bash
npm run lint
npm run build
node --experimental-strip-types --test tests/*.test.mjs
npm run test:e2e:auth
```

GitHub Actions must report complete CI matrix and Auth E2E `success` for the same SHA.

- [ ] **Step 3: Review PR diff and threads**

Confirm changed-file scope, zero unresolved review threads, current `main` divergence, and no temporary workflow/scripts.

- [ ] **Step 4: Update PR evidence and mark ready**

Include exact SHA, test count, lint/build, matrix, Auth E2E, security review, and explicit non-goals.

- [ ] **Step 5: Merge with expected-head protection**

Merge only when PR is mergeable, base is current, all exact-head checks are green, and no unresolved threads exist.

- [ ] **Step 6: Verify merged result and update issue #44**

Confirm `main` equals merge SHA, merged tree matches verified feature head, and keep #44 open for Storage Center UI and any later real controlled migration.
