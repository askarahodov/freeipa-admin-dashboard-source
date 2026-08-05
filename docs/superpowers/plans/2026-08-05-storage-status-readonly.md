# Read-only Storage Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only, versioned, read-only storage status API and an HTTP CLI client without applying migrations or exposing database internals.

**Architecture:** A focused `storage-status.ts` service owns bounded metadata collection over an injected query adapter and hardened schema inspector. `worker/storage-status-entry.ts` owns role enforcement, response status, and audit. The exact path is allowed through schema/maintenance recovery gates, then dispatched inside `worker/local-secure-entry.ts` only after the existing local-session or explicit service-admin-token resolution. `scripts/storage-inspect.ts` consumes the same HTTP contract when the browser UI is unavailable.

**Tech Stack:** TypeScript, Cloudflare D1/SQLite read-only queries, Node.js 22, existing audit/RBAC helpers, Node test runner, GitHub Actions.

## Global Constraints

- No DDL, DML, migration apply, restore, cleanup, integrity repair, or arbitrary SQL.
- Schema inspection must call `inspectPortalSchema`, never `ensurePortalSchema`.
- Request input must never influence table names, pragmas, or SQL fragments.
- API and CLI must not expose DB paths, SQL, table names, rows, credentials, hashes, ciphertext, internal URLs, raw exceptions, or raw drift identifiers.
- Viewer/operator/anonymous denial must happen before database inspection.
- Service-admin token remains explicit-path only; no wildcard administrative bypass.
- Existing health endpoints and Docker HEALTHCHECK remain unchanged.

---

### Task 1: Storage inspection service

**Files:**
- Create: `storage-status.ts`
- Create: `storage-encryption-self-test.ts`
- Test: `tests/storage-status.test.mjs`

- [x] Write failing behavior tests for healthy/degraded/unavailable, schema drift, unsupported pragmas, fixed domain counts, lifecycle metadata, redaction, and query bounds.
- [x] Record RED: the full suite failed only because `storage-status.ts` did not exist.
- [x] Implement the bounded service using canonical table names and `inspectPortalSchema` only.
- [x] Separate successful backup-export audit actions from production-restore actions.
- [x] Verify lint, production build, focused tests, and complete server suite.

### Task 2: Admin API, authorization, and audit

**Files:**
- Create: `worker/storage-status-entry.ts`
- Test: `tests/storage-status-api.test.mjs`

- [x] Write failing API tests for GET-only behavior, denial before inspection, admin success, degraded/unavailable mapping, correlation ID, and audit bounds.
- [x] Record RED: the full suite failed only because the handler did not exist.
- [x] Implement role enforcement, safe HTTP responses, and best-effort `storage.inspect` audit.
- [x] Verify lint, production build, focused tests, and complete server suite.

### Task 3: Runtime routing and service-admin boundary

**Files:**
- Create: `storage-status-contract.ts`
- Modify: `worker/local-secure-entry.ts`
- Modify: `worker/schema-migrations-entry.ts`
- Modify: `worker/maintenance-mode-gate.ts`
- Modify: `admin-session-authorization.ts`
- Test: `tests/storage-status-routing-contract.test.mjs`

- [x] Write routing contracts for exact recovery allowlists, local-session ordering, explicit service-admin access, and unchanged health/Docker behavior.
- [x] Record RED before route composition existed.
- [x] Reject the first wrapper design after Auth E2E exposed existing settings source-contract regressions.
- [x] Preserve the direct `settings-input-normalizer-entry` composition and dispatch storage inside `local-secure-entry.ts` only after session/token resolution.
- [x] Verify settings/schema source contracts, lint, build, complete server suite, and Chromium Auth E2E.

### Task 4: Browser-independent CLI client

**Files:**
- Create: `storage-inspect-cli.ts`
- Create: `scripts/storage-inspect.ts`
- Modify: `package.json`
- Test: `tests/storage-inspect-cli.test.mjs`

- [x] Write CLI tests for URL validation, bounded timeout, environment-only token, safe auth/server/network/protocol failures, exact endpoint, and deterministic exit codes.
- [x] Implement parser and runner with `redirect: manual`, AbortSignal timeout, fixed safe error codes, and no raw body/error output.
- [x] Register `npm run inspect:storage`.
- [x] Verify lint, production build, focused tests, and complete server suite.

### Task 5: Documentation and full verification

**Files:**
- Create: `docs/STORAGE_STATUS.md`
- Modify: `README.md`
- Modify: this plan and the design spec

- [x] Document API schema, role boundary, query bounds, CLI usage, exit codes, redaction, degraded semantics, rollback, and explicit exclusions.
- [x] Update README API and command inventory.
- [x] Review design/plan against the implemented auth composition.
- [ ] Run final exact-head lint and production build.
- [ ] Run final exact-head complete server suite and per-file matrix.
- [ ] Run final exact-head Auth E2E Chromium scenarios.
- [ ] Review the final diff, secret/PII exposure, DDL/DML absence, Docker health invariants, and unresolved review threads.
- [ ] Mark PR ready and squash merge.
- [ ] Comment #44 with evidence and keep it open for integrity/preflight/apply/UI checkpoints.
