# Dependency Health Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion task by task.

**Goal:** Add a sanitized, cached `/health/dependencies` contract for FreeIPA and XYOps without allowing external dependency failures to affect liveness, readiness or container restart behavior.

**Architecture:** `worker/dependency-health.ts` owns the versioned response, read-only effective-settings projection, bounded probes, classification, process-local cache and last-success metadata. `worker/schema-migrations-entry.ts` dispatches the endpoint after the independent live/ready handler but before maintenance/authentication gates. FreeIPA is probed through the authenticated loopback Node Gateway; XYOps is probed directly with a bounded read-only request. The Gateway returns stable safe error codes in addition to its existing sanitized message.

**Storage owner:** The cache is process-local and contains only sanitized results. It never stores URLs, usernames, credentials, tokens, response bodies or exceptions. `portal_settings_revisions.health_json` remains revision history and is not reused as runtime cache. Persistent health history belongs to a later monitoring/diagnostics checkpoint.

**Tech stack:** TypeScript, Cloudflare Workers/Workerd, D1 read-only settings projection, Node Gateway, Node test runner, GitHub Actions.

## Invariants

- `/health/live` and `/health/ready` behavior remains unchanged.
- FreeIPA/XYOps failure returns dependency `degraded` but does not change liveness/readiness.
- Probe timeout is bounded; concurrent requests coalesce; successful or failed results are cached briefly.
- Cache contains sanitized result only and is invalidated by TTL.
- Public responses never contain URL, username, password, API key, bearer token, cookie, raw body or raw exception.
- FreeIPA probe uses the same authenticated loopback Gateway path as production operations.
- XYOps probe is read-only and never starts/cancels a job.
- HTTP 200 is used for evaluated healthy/degraded dependency state; HTTP 503 is reserved for inability to evaluate because DB/schema/settings are unavailable.
- No schema, DDL, RBAC, maintenance or Docker probe change is introduced.

## Task 1 — RED behavior contracts

**Create:**
- `tests/dependency-health-contracts.test.mjs`
- `tests/freeipa-gateway-error-codes.test.mjs`

**Modify:**
- `tests/health-routing-contract.test.mjs`

- [ ] Add failure-injection tests for DB/schema unavailable, unconfigured services, FreeIPA DNS/TLS/timeout/auth failure, XYOps 401/429/500/timeout and all-healthy.
- [ ] Assert stable state/category/code/latency/lastSuccessAt and no secret sentinel leakage.
- [ ] Assert process-local TTL cache, source metadata and concurrent request coalescing.
- [ ] Assert Gateway emits stable safe error code without credentials, URL or upstream body.
- [ ] Assert outer dependency dispatch occurs before schema/maintenance/auth runtime gates.
- [ ] Run focused tests and record expected RED failures.

## Task 2 — Minimal implementation

**Create:**
- `worker/dependency-health.ts`

**Modify:**
- `worker/schema-migrations-entry.ts`
- `scripts/freeipa-gateway.mjs`

- [ ] Implement versioned sanitized dependency response and fixed allowlisted categories.
- [ ] Implement read-only effective settings load from `app_settings`, AES-GCM decryption and environment fallback.
- [ ] Implement bounded Gateway and XYOps probes with bounded response parsing.
- [ ] Implement 30-second sanitized cache, last success retention and in-flight coalescing.
- [ ] Add safe Gateway error codes while preserving existing `/rpc` response compatibility.
- [ ] Dispatch `/health/dependencies` after live/ready and before ordinary runtime gates.
- [ ] Run focused tests to GREEN.

## Task 3 — Operations and verification

**Modify:**
- `docs/HEALTH_CONTRACTS.md`
- `README.md`

- [ ] Document states, status categories, cache semantics and timeout policy.
- [ ] Explicitly prohibit use as Docker liveness/readiness restart signal.
- [ ] Run lint, production build, complete server suite, matrix and Auth E2E.
- [ ] Open an isolated PR referencing #58 and merge only after exact-head CI/Auth E2E success.
