# Health Metrics Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion task by task.

**Goal:** Add a stable low-cardinality Prometheus-compatible baseline metrics endpoint and alerting rules for portal liveness, readiness and local mandatory components without causing FreeIPA/XYOps probes during scrape.

**Architecture:** A focused `worker/health-metrics.ts` owns `GET /metrics/health`. It reuses only the existing live/ready health handler with injected dependencies, converts its sanitized versioned JSON responses into Prometheus text exposition, and never invokes `handleDependencyHealthRequest`. `worker/schema-migrations-entry.ts` dispatches metrics after health/diagnostics resources and before ordinary schema, maintenance and authentication gates. Static alert rules live in `monitoring/prometheus-health-alerts.yml`.

**Tech stack:** TypeScript, Cloudflare Workers/Workerd, Prometheus text exposition 0.0.4, Prometheus-compatible alert rules, Node test runner, GitHub Actions.

## Invariants

- Metrics scrape never contacts FreeIPA or XYOps and never reads integration credentials/settings.
- Existing live/ready/dependency JSON contracts remain unchanged.
- Metric names and labels are bounded and stable; labels are limited to fixed check names and sanitized build version.
- No username, URL, hostname, run ID, resource name, error text, code, token or API key appears as a label.
- Endpoint returns text/plain with `Cache-Control: no-store` and does not expose raw JSON or exception text.
- Readiness failure is represented as gauge value `0`; the metrics endpoint itself remains scrapeable with HTTP 200.
- Docker HEALTHCHECK remains `/health/live`; metrics are not a restart probe.
- No DDL, RBAC, maintenance state, integration mutation or monitoring deployment is introduced.

## Task 1 — RED behavior contracts

**Create:**
- `tests/health-metrics-contract.test.mjs`
- `tests/health-metrics-routing-contract.test.mjs`
- `tests/prometheus-health-alerts.test.mjs`

- [ ] Assert deterministic Prometheus output for healthy and unready local states.
- [ ] Assert fixed metrics for live, ready, database/schema/encryption/gateway checks, schema versions and build info.
- [ ] Assert the handler calls only live/ready contracts and never requests `/health/dependencies`.
- [ ] Assert labels reject/escape unsafe values and output excludes secrets, URLs, raw codes and exception messages.
- [ ] Assert non-GET returns 405 and unrelated routes are ignored.
- [ ] Assert outer dispatch precedes ordinary runtime gates but does not change Docker probing.
- [ ] Assert alert rules use only emitted metrics, bounded labels, explicit durations and no automatic restart action.
- [ ] Run focused tests and record expected RED failures.

## Task 2 — Minimal implementation

**Create:**
- `worker/health-metrics.ts`
- `monitoring/prometheus-health-alerts.yml`

**Modify:**
- `worker/schema-migrations-entry.ts`

- [ ] Implement safe metric/label helpers and deterministic text exposition.
- [ ] Reuse `handleHealthRequest` only for `/health/live` and `/health/ready`.
- [ ] Emit `portal_health_live`, `portal_health_ready`, four fixed readiness-check gauges, schema current/latest/lag, and sanitized `portal_build_info`.
- [ ] Return zero/unknown-safe values when readiness JSON is unavailable without leaking errors.
- [ ] Add alert rules for missing liveness series, sustained unready state, schema lag, encryption failure and local Gateway failure.
- [ ] Dispatch `/metrics/health` before schema/maintenance/authentication gates.
- [ ] Run focused tests to GREEN.

## Task 3 — Documentation and verification

**Modify:**
- `README.md`
- `docs/HEALTH_CONTRACTS.md`

- [ ] Document scrape example, metric contract and low-cardinality policy.
- [ ] Document that dependency degraded alerting continues to use `/health/dependencies`; the baseline metrics scrape does not refresh it.
- [ ] Document rule semantics and explicit no-restart policy for external dependencies.
- [ ] Run lint, production build, complete server suite, per-file matrix and Auth E2E.
- [ ] Open an isolated PR referencing #58 and merge only after exact-head CI/Auth E2E success.
