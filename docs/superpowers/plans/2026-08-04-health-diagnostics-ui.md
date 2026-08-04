# Health Diagnostics UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion task by task.

**Goal:** Provide an operator-facing diagnostics page that consumes the live, ready and dependency health contracts without exposing connectivity details or coupling external failures to restart behavior.

**Architecture:** A focused `worker/health-diagnostics-ui.ts` owns three immutable same-origin resources: `/diagnostics/health`, `/diagnostics/health.js` and `/diagnostics/health.css`. `worker/schema-migrations-entry.ts` dispatches them immediately after health JSON handlers and before schema, maintenance and authentication gates, so the page remains available during DB/migration incidents. Browser JavaScript fetches only sanitized health endpoints, renders with `textContent`, maps allowlisted codes/categories to remediation guidance, and supports manual refresh/copy of sanitized status. No inline script/style, external CDN, localStorage, credentials, URLs or raw errors are used.

**Tech stack:** TypeScript, Cloudflare Workers/Workerd, standards-based HTML/CSS/JavaScript, Node test runner, GitHub Actions.

## Invariants

- Existing `/health/live`, `/health/ready`, `/health/dependencies` response contracts remain unchanged.
- UI remains reachable when DB/schema/maintenance/authentication is unavailable.
- UI fetches only same-origin health endpoints with `cache: "no-store"`.
- Rendering uses `textContent` and fixed DOM nodes; no `innerHTML`, `eval`, inline handlers or dynamic script injection.
- CSP permits only self-hosted script/style and denies framing, objects, forms and remote connections.
- UI never displays URL, username, API key, password, token, raw exception or upstream body.
- The page clearly states that dependency degradation must not trigger portal restart.
- No DDL, RBAC, maintenance state, Docker probe or external dependency mutation is introduced.

## Task 1 — RED behavior contracts

**Create:**
- `tests/health-diagnostics-ui.test.mjs`
- `tests/health-diagnostics-routing-contract.test.mjs`

- [ ] Assert HTML route, content type, `no-store`, hardened CSP and external same-origin assets.
- [ ] Assert JavaScript fetches live/ready/dependencies, uses `textContent`, contains allowlisted remediation mapping and excludes unsafe DOM/storage/network primitives.
- [ ] Assert CSS route and responsive status-card classes.
- [ ] Assert nonmatching routes are not intercepted and non-GET methods return 405.
- [ ] Assert outer dispatch occurs before schema status, missing DB and ordinary runtime gates.
- [ ] Run focused tests and record expected RED failures before implementation.

## Task 2 — Minimal implementation

**Create:**
- `worker/health-diagnostics-ui.ts`

**Modify:**
- `worker/schema-migrations-entry.ts`

- [ ] Implement immutable HTML shell with summary, three contract cards, dependency table, remediation area and actions.
- [ ] Implement same-origin JavaScript with bounded fetch timeout, sanitized rendering, stable code/category labels, relative timestamps, manual refresh and copy action.
- [ ] Implement standalone responsive CSS with visible healthy/degraded/unready states.
- [ ] Add strict security headers: CSP, frame denial, no-sniff, no-referrer and no-store.
- [ ] Dispatch diagnostics resources after health handlers and before schema/maintenance/authentication gates.
- [ ] Run focused tests to GREEN.

## Task 3 — Documentation and verification

**Modify:**
- `README.md`
- `docs/HEALTH_CONTRACTS.md`

- [ ] Document `/diagnostics/health`, its incident-use purpose and sanitized scope.
- [ ] Document remediation mapping and explicit no-restart interpretation for degraded dependencies.
- [ ] Run lint, production build, complete server suite, per-file matrix and Auth E2E.
- [ ] Open an isolated PR referencing #58 and merge only after exact-head CI/Auth E2E success.
