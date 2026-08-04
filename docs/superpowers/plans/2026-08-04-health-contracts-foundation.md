# Health Contracts Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce independent public liveness and internal-readiness contracts while preserving the legacy health endpoint as an explicitly deprecated compatibility alias.

**Architecture:** The outer `worker/schema-migrations-entry.ts` owns health dispatch so liveness remains reachable before D1/schema, maintenance, authentication and integration gates. A focused `worker/health-contracts.ts` module produces versioned, sanitized responses and performs only mandatory local readiness checks: D1/schema state, encryption self-test and authenticated loopback Gateway health. External FreeIPA/XYOps dependency probes remain a later isolated checkpoint of #58.

**Tech Stack:** TypeScript, Cloudflare Workers/Workerd, D1, Node.js test runner, Docker HEALTHCHECK, GitHub Actions.

## Global Constraints

- `/health/live` must not access D1, encryption material, the Gateway or any external network.
- `/health/ready` must return non-2xx when D1/schema, encryption or the local Gateway is unavailable.
- `/api/integrations/health` remains compatible with `{ ok: true }` consumers and carries explicit deprecation metadata.
- Responses must never expose URLs, usernames, API keys, Gateway tokens, encryption keys, SQL or raw exception text.
- FreeIPA and XYOps availability must not affect liveness or this checkpoint's readiness contract.
- All health responses use `cache-control: no-store` and a versioned JSON contract.
- Docker HEALTHCHECK uses liveness; reverse proxies/orchestrators may use readiness.
- No destructive migration, schema change, RBAC weakening or maintenance-gate bypass is introduced.

---

### Task 1: Specify behavior with regression tests

**Files:**
- Create: `tests/health-contracts.test.mjs`
- Create: `tests/freeipa-gateway-health.test.mjs`
- Modify: `tests/portal-schema-boundary.test.mjs`

**Interfaces:**
- Consumes: future `handleHealthRequest(request, env, dependencies)` from `worker/health-contracts.ts`.
- Produces: behavior contracts for live, ready, legacy alias, sanitization and Gateway authentication.

- [ ] **Step 1: Write a failing liveness test**

Create a test that calls `/health/live` with dependency functions that throw if invoked, then asserts HTTP 200, `state: "healthy"`, `contractVersion: "1"`, `check: "liveness"`, `cache-control: no-store`, and zero dependency calls.

- [ ] **Step 2: Write failing readiness tests**

Cover missing DB, incompatible schema, malformed encryption key, unavailable Gateway and the fully healthy path. Assert stable codes and verify serialized payloads do not contain supplied secret/URL/error sentinel values.

- [ ] **Step 3: Write failing compatibility tests**

Assert `/api/integrations/health` preserves `ok: true`, identifies itself as deprecated, adds a successor link to `/health/live`, and remains dispatched before the schema boundary.

- [ ] **Step 4: Write failing Gateway tests**

Start `createFreeIpaGateway` on loopback, require the bearer token for `GET /health`, assert authorized HTTP 200 and unauthorized HTTP 401, and verify that no FreeIPA upstream request is made.

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
node --experimental-strip-types --test tests/health-contracts.test.mjs tests/freeipa-gateway-health.test.mjs tests/portal-schema-boundary.test.mjs
```

Expected: FAIL because `worker/health-contracts.ts`, the Gateway route and outer dispatch do not exist.

### Task 2: Implement minimal live and ready contracts

**Files:**
- Create: `worker/health-contracts.ts`
- Modify: `worker/schema-migrations-entry.ts`
- Modify: `scripts/freeipa-gateway.mjs`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `PortalSchemaStatus`, `ensurePortalSchema`, `migrationCapableDatabase`, `IPA_NODE_GATEWAY_URL`, `IPA_NODE_GATEWAY_TOKEN`, `CONFIG_ENCRYPTION_KEY`.
- Produces: `handleHealthRequest(request, env, dependencies): Promise<Response | null>`.

- [ ] **Step 1: Add versioned response helpers**

Define `HealthState`, `HealthCheckResult`, safe metadata and a JSON response helper with `cache-control: no-store`. Return only stable state/code/latency and numeric schema versions.

- [ ] **Step 2: Implement liveness and legacy alias**

Handle `GET /health/live` without reading DB or invoking injected dependencies. Handle `GET /api/integrations/health` with the same healthy result, `deprecated: true`, `Link: </health/live>; rel="successor-version"`, and a deprecation warning header.

- [ ] **Step 3: Implement readiness checks**

For `GET /health/ready`, require a migration-capable DB, call the injected schema checker, perform an AES-GCM encrypt/decrypt self-test with the configured 32-byte key, and call the authenticated loopback Gateway `/health` route with a bounded timeout. Return HTTP 503 and stable sanitized codes on failure.

- [ ] **Step 4: Put dispatch outside all gates**

Call `handleHealthRequest` at the beginning of `schema-migrations-entry.ts` before `/api/schema/status`, missing-DB handling and schema migration execution.

- [ ] **Step 5: Add authenticated Gateway health**

Extend `createFreeIpaGateway` so `GET /health` validates the same bearer token and returns `{ ok: true }` without contacting FreeIPA. Preserve the existing `/rpc` behavior.

- [ ] **Step 6: Move Docker HEALTHCHECK to liveness**

Change the container probe from `/api/integrations/health` to `/health/live`.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run:

```bash
node --experimental-strip-types --test tests/health-contracts.test.mjs tests/freeipa-gateway-health.test.mjs tests/portal-schema-boundary.test.mjs
```

Expected: PASS.

### Task 3: Document operations and verify the branch

**Files:**
- Modify: `README.md`
- Create: `docs/HEALTH_CONTRACTS.md`

**Interfaces:**
- Consumes: `/health/live`, `/health/ready`, deprecated `/api/integrations/health`.
- Produces: Docker, reverse-proxy and orchestrator probe policy for operators.

- [ ] **Step 1: Document endpoint policy**

Document that Docker uses liveness, ingress/orchestrators use readiness, external FreeIPA/XYOps failures do not restart the portal, responses are sanitized, and dependency health is the next #58 checkpoint.

- [ ] **Step 2: Update the API index**

List the new routes in `README.md`, mark the legacy alias deprecated and link the detailed runbook.

- [ ] **Step 3: Run all required verification**

Run:

```bash
npm run lint
npm run build
node --experimental-strip-types --test --test-concurrency=1 tests/*.test.mjs
npm run test:e2e:auth
```

Expected: all commands PASS.

- [ ] **Step 4: Open an isolated PR**

Create a PR targeting `main`, reference #58, include exact-head CI/Auth E2E evidence, and do not merge until every required workflow succeeds on the final SHA.
