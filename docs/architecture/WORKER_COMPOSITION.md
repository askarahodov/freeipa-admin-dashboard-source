# Worker HTTP composition and ownership inventory

## Purpose and evidence checkpoint

This document records the **current HTTP Worker composition** and the ownership boundaries that must remain intact while #56 replaces the historical wrapper chain with explicit application composition.

It is an ownership/integration map, not a second route registry. Exact stable method/path/auth/permission/mutation metadata remains canonical in `src/auth/portal-route-contract.ts`. `src/auth/portal-route-router.ts` is the canonical metadata-derived matcher; `src/auth/portal-route-security-plan.ts` derives security stages but does not itself enforce them. The #628 application router reuses that matcher rather than defining another set of route patterns.

The original #627 inventory was verified against `main` at `60c162e0d2c71b3a4fc061f3dce1147e0a119fbd` on 2026-09-10. The explicit application/security composition foundation is merged through #657; #658 extracted controlled storage migration handling and #659 extracted maintenance into the same composition boundary. The current #629 checkpoint extracts the outer service-admin authentication/adaptation boundary while preserving local-session and same-origin ownership below it. Production-host/trusted-proxy concerns remain owned by #53 and stay outside this Worker refactor.

If code and this document disagree, current code/tests and the source-of-truth registry win. Revalidate the current branch and open PRs before using this inventory for an implementation slice.

## Layer boundary

The self-hosted request path has two different composition concerns and #56 must not merge them accidentally:

```text
process / transport hosting
  scripts/start-production.mjs
    -> runtime/production-runtime.mjs
    -> Node Worker host / SQLite / scheduler / shutdown
    -> built Worker artifact

HTTP application composition
  worker/schema-migrations-entry.ts
    -> worker/application.ts
    -> worker/application-router.ts
    -> worker/security-composition.ts
    -> explicit security gates + compatibility wrapper/handler graph described below
    -> worker/index.ts
    -> Vinext application/static fallback
```

`runtime/**` and production-host scripts own listener/process/trusted-proxy hosting. `worker/**` owns the Worker-facing HTTP adapters, security gates and handler composition. Reverse-proxy trust policy remains #53 even while #56 changes application composition.

## Current request composition

### Top-level boundary

`worker/schema-migrations-entry.ts` is the current built Worker entry. Before delegating into the ordinary schema-gated application path it handles infrastructure surfaces that intentionally work before that boundary:

- liveness/readiness and legacy health through `worker/health-contracts.ts`;
- dependency health through `worker/dependency-health.ts`;
- the sanitized health diagnostics document/assets through `worker/health-diagnostics-ui.ts`;
- health metrics through `worker/health-metrics.ts`;
- service-admin schema status;
- explicit storage status/integrity/migration paths that must reach their guarded downstream handlers before the ordinary schema-readiness failure;
- the schema readiness gate for ordinary requests;
- the same schema readiness boundary for `scheduled` execution.

For downstream HTTP requests, `schema-migrations-entry.ts` delegates to `worker/application.ts`. `application.ts` is the single explicit post-schema/application composition point for ordinary traffic and also receives the intentionally allowlisted storage administration paths. It classifies the request through `worker/application-router.ts`; every classification then enters `worker/security-composition.ts`.

`security-composition.ts` now owns the first three extracted security gates. `worker/middleware/storage-migration-apply.ts` invokes the existing controlled migration apply/status/reconcile handler before maintenance. A handled migration response short-circuits unchanged. Every other HTTP request then enters the existing dependency-injected `worker/maintenance-mode-gate.ts`; the gate preserves the original `Request`, environment and execution context for delegated traffic, enforces its recovery allowlist and fail-closed behavior, and delegates allowed traffic into `worker/middleware/service-admin-authentication.ts`. The service-admin gate preserves the local-mode restriction, canonical administrative allowlist, constant-time `ADMIN_TOKEN` authorization and the exact synthetic static admin environment used by the former wrapper, then delegates into `maintenance-control-root-entry.ts`. Scheduled execution bypasses the HTTP-only migration and service-admin gates but enters `handleMaintenanceScheduledGate` before the remaining compatibility runtime, matching the former service-admin wrapper's scheduled pass-through. Local-session routing, authorization, stable-route handler selection and most audit/error behavior remain compatibility-owned. For negative classifications only, the application still owns the final outward JSON envelope **after** security/compatibility execution: a known method mismatch is normalized only when downstream already returned `405`, and an unknown `/api/**` route is normalized only when downstream already returned `404`. Other statuses are returned unchanged.

### Normal downstream wrapper graph

For a request that reaches application/security composition, the verified downstream graph is:

```text
schema-migrations-entry.ts
  -> application.ts
  -> application-router.ts
       -> canonical match/classification
       -> security composition dispatch
       -> security-preserving negative response finalization after downstream returns
  -> security-composition.ts
       -> middleware/storage-migration-apply.ts
          -> storage-migration-apply-entry.ts (exact controlled migration paths only)
       -> maintenance-mode-gate.ts
       -> middleware/service-admin-authentication.ts
  -> maintenance-control-root-entry.ts
  -> backup-selective-restore-root-entry.ts
  -> freeipa-group-member-entry.ts
  -> freeipa-user-bulk-entry.ts
  -> freeipa-user-query-entry.ts
  -> session-management-entry.ts
  -> diagnostics-entry.ts
  -> settings-revisions-entry.ts
  -> local-secure-entry.ts
  -> settings-input-normalizer-entry.ts
  -> settings-source-context-entry.ts
  -> settings-source-safe-entry.ts
       |-> settings-source-entry.ts ---------|
       |                                     v
       `-> settings-lifecycle-entry.ts -> secure-entry.ts -> worker/index.ts
```

The graph is not strictly linear. `settings-source-safe-entry.ts` chooses either the source-aware path or the lifecycle path depending on the request and may construct an effective integration environment before delegation. Future migration must preserve this branch behavior until an explicit replacement has parity evidence.

`worker/index.ts` remains the broad base HTTP owner. It currently owns much of `/api/integrations/**`, the sanitized backup export entry, Vinext image optimization, route-to-root HTML adaptation for the SPA-like administrative screens, and the final Vinext application/static fallback.

## Canonical stable route coverage

The following groups cover every stable route contract present in `portalRouteContracts` at the evidence checkpoint. The identifiers are repeated here only to prove inventory coverage; method/path/security metadata must still be read from the canonical contract rather than maintained independently in this document.

`tests/auth/portal-application-router.test.mjs` materializes every current canonical route pattern and proves that the explicit application router resolves it back to the same route id. It also proves that negative response finalization cannot promote successful, authentication, authorization, conflict, rate-limit or maintenance responses into routing errors. Current wrappers/handlers remain the runtime enforcement owners except for the explicitly composed controlled storage migration, maintenance and outer service-admin gates.

### Infrastructure and schema

`health.live`, `health.ready`, `integration.health.compat`, `schema.status`

Actual HTTP owners: `worker/health-contracts.ts` and `worker/schema-migrations-entry.ts`. Liveness/readiness and schema status intentionally execute before ordinary post-schema application dispatch even though the canonical matcher can classify their stable metadata.

### Local authentication and user administration

`auth.session`, `auth.login`, `auth.logout`, `auth.users.list`, `auth.users.create`, `auth.users.update`, `auth.users.delete`, `auth.users.password-reset`, `auth.users.sessions-revoke`

Actual HTTP owner: `worker/local-secure-entry.ts`, using canonical local-auth/session helpers under `src/auth/**`.

### Settings lifecycle and revisions

`settings.read`, `settings.update`, `settings.test`, `settings.effective`, `settings.drafts.create`, `settings.drafts.read`, `settings.drafts.validate`, `settings.drafts.apply`, `settings.drafts.cancel`, `settings.revisions.list`, `settings.revisions.read`

Actual HTTP ownership is currently split across `worker/index.ts`, `worker/settings-lifecycle-entry.ts`, `worker/settings-revisions-entry.ts` and the settings-source wrappers. This split is one of the explicit consolidation targets for #633, not a reason to create a new settings domain owner in #628.

### FreeIPA directory and mutation routes

`freeipa.users.list`, `freeipa.users.export`, `freeipa.groups.list`, `freeipa.groups.members`, `freeipa.actions`, `freeipa.bulk`

Actual HTTP ownership is split across `worker/index.ts`, `worker/freeipa-user-query-entry.ts`, `worker/freeipa-user-bulk-entry.ts` and `worker/freeipa-group-member-entry.ts`; canonical query/domain logic lives under `src/freeipa/**` and the private Gateway remains the upstream trust boundary.

### XYOps catalog, runs, approvals and notifications

`integration.status`, `xyops.catalog.read`, `xyops.catalog.history`, `xyops.catalog.options`, `xyops.catalog.run`, `xyops.runs.list`, `xyops.runs.file`, `xyops.runs.cancel`, `xyops.runs.rerun`, `xyops.approvals.list`, `xyops.approvals.approve`, `xyops.approvals.reject`, `xyops.approvals.cancel`, `xyops.approvals.execute`, `xyops.notifications.list`, `xyops.notifications.read`

Actual HTTP owner is primarily `worker/index.ts`. Portal-side operation/catalog/approval/presentation state belongs to the existing `src/operations/**` owners; XYOps remains authoritative for process definitions and execution/scheduler/queue semantics.

### XYOps administration and catalog synchronization

`xyops.routes.read`, `xyops.routes.update`, `xyops.presentation.read`, `xyops.presentation.update`, `xyops.catalog-policies.read`, `xyops.catalog-policies.update`, `xyops.approval-policies.read`, `xyops.approval-policies.update`, `xyops.catalog-sync.read`, `xyops.catalog-sync.run`

Administrative route/policy handlers are primarily in `worker/index.ts`. Catalog synchronization is a notable exception: `worker/secure-entry.ts` currently owns its GET/POST API, persistence/locking, audit and scheduled execution.

### Backup and selective restore

`backup.export.sanitized`, `backup.export.encrypted`, `backup.preview.sanitized`, `backup.preview.encrypted`, `backup.restore.test`, `backup.restore.prepare`, `backup.restore.commit`, `backup.restore.cancel`

HTTP ownership is distributed across the backup entry/dispatch wrappers. Canonical backup/recovery domain logic remains under `src/backup/**` and `src/recovery/**`. Destructive full restore is intentionally offline and is not represented as a normal HTTP route.

### Storage administration

`storage.status`, `storage.integrity`, `storage.migrations.preflight`, `storage.migrations.apply`, `storage.migrations.apply-status`, `storage.migrations.reconcile`

HTTP handlers are the dedicated `worker/storage-*-entry.ts` adapters. The apply/status/reconcile decision boundary is composed explicitly by `worker/security-composition.ts` through `worker/middleware/storage-migration-apply.ts`, while the canonical handler remains `worker/storage-migration-apply-entry.ts`. Status, integrity and migration preflight continue through their existing guarded compatibility paths. Canonical schema remains in `db/**`; storage status/integrity/migration logic remains under `src/storage/**` and recovery/runtime owners where applicable.

### Maintenance administration

`maintenance.status`, `maintenance.prepare`, `maintenance.enter`, `maintenance.verification.start`, `maintenance.verification.smoke`, `maintenance.exit`, `maintenance.complete`, `maintenance.cancel`

The availability/security decision boundary is `worker/maintenance-mode-gate.ts`, invoked explicitly by `worker/security-composition.ts`. HTTP ownership of control and verification operations remains in the maintenance control/verification adapters. Canonical maintenance state/repository logic remains under `src/recovery/maintenance/**`.

## Security and runtime ownership by route family

| Route family | Canonical auth/permission owner | Current HTTP enforcement/adaptation | Persistence / external owner | Audit and representative verification |
| --- | --- | --- | --- | --- |
| Health/schema | `portal-route-contract.ts`; schema status uses explicit service-admin boundary | `schema-migrations-entry.ts` handles health before ordinary schema gating and enforces schema status authorization | canonical schema/migrations under `db/**`; readiness probes private Gateway; dependency health may probe FreeIPA/XYOps | health/dependency contract tests, schema boundary tests |
| Local auth/users | local-auth/session/permission helpers under `src/auth/**` | `local-secure-entry.ts` owns login/logout/admin-user HTTP behavior, same-origin protection and downstream local-session delegation | `portal_users`, `portal_sessions`; no FreeIPA identity ownership | auth/RBAC/same-origin/request-context tests; audit for user administration and rate-limit denials |
| Settings | canonical permissions + route contract | settings lifecycle/source/revision wrappers plus base Worker; source-safe path has its own admin-token authorization that may represent service-admin proof or internal local-admin delegation | `app_settings`, settings drafts/revisions/apply/reset/source-lock state; encrypted integration secrets | settings lifecycle/source/revision tests; settings audit/compensation events |
| FreeIPA | canonical route permissions (`directory.read`, `freeipa.write`, conditional delete) | local session established before FreeIPA adapters/base Worker; wrapper-specific query/bulk/member handling | `src/freeipa/**` + private server-side FreeIPA Gateway; FreeIPA owns directory data | `tests/freeipa/**`, permission/route contract tests, operation/audit tests for mutations |
| XYOps/run/approval | canonical route metadata plus portal permissions | mostly `worker/index.ts`; approval/run checks remain in current handler/domain calls | portal operation/catalog/approval tables; server-side XYOps client; XYOps owns execution semantics | `tests/operations/**`, approval/run/catalog contracts, audit events from current handlers |
| Catalog sync | admin/service-admin route metadata | `secure-entry.ts` combines resolved identity context, HTTP handler and scheduler | `xyops_catalog_sync_lock`, `xyops_catalog_sync_runs`; live catalog fetch through current Worker/XYOps path | `tests/operations/catalog-scheduled-sync.test.mjs`, route/security-plan tests; `catalog.sync` audit |
| Backup/restore | canonical backup permissions and required admin role where declared | dedicated backup root/dispatch adapters plus local/service-admin delegation | canonical `src/backup/**`/`src/recovery/**`; DB/recovery metadata owned by canonical schema/domain modules | `tests/backup/**`, recovery/authorization/negative tests; guarded audit events |
| Storage | admin/service-admin route metadata | controlled migration apply/status/reconcile enters explicit `security-composition.ts` middleware and then the unchanged storage handler; other storage surfaces remain dedicated compatibility adapters | `src/storage/**`, `db/**` schema/migration owner, migration journals/locks | storage/migration/integrity contract and recovery tests |
| Maintenance | `maintenance.manage` / service-admin metadata | `security-composition.ts` executes `maintenance-mode-gate.ts` before service-admin; control/smoke adapters remain downstream | `src/recovery/maintenance/**` and canonical maintenance persistence | maintenance positive/negative/recovery tests and audit contracts |

The table intentionally names persistence/domain owners rather than duplicating a complete schema table list. `db/portal-schema.ts` is authoritative for exact table shape.

## Maintenance and recovery gate semantics

`worker/application.ts` sends classified HTTP requests into `worker/security-composition.ts`. Controlled migration apply/status/reconcile is evaluated first by the explicit storage migration middleware. If that handler returns a response, maintenance is intentionally not consulted, preserving the existing recovery-capable order. All other traffic enters `handleMaintenanceGate` directly from `security-composition.ts`; only traffic that passes maintenance reaches `handleServiceAdminAuthenticationGate`, and only then the remaining compatibility graph starting at `maintenance-control-root-entry.ts`. Negative response finalization happens only after the complete security/compatibility call returns, so the router cannot short-circuit maintenance/service-admin security or replace a maintenance `503` with `404/405`.

Current behavior is fail-closed when maintenance state cannot be read. Ordinary `/api/**` traffic is rejected while maintenance is active. The following classes are intentionally reachable through the maintenance boundary so recovery can be controlled and diagnosed:

- maintenance control and verification routes;
- `/api/schema/status`;
- storage status, integrity and migration preflight;
- the public `/api/maintenance/status` compatibility/status surface;
- legacy health is allowed through with an `x-portal-maintenance-state` response header.

Controlled migration apply/status/reconcile is deliberately outside the maintenance gate and keeps its own guarded authorization/input/error contract. Non-API HTML/static traffic delegates through the maintenance gate. Scheduled work enters `handleMaintenanceScheduledGate` from `security-composition.ts` and is suppressed unless maintenance is inactive (apart from the explicit test-bypass contract). Phase #629 must preserve these distinctions rather than applying a blanket middleware order that blocks recovery control.

## Supplemental HTTP surfaces outside `portalRouteContracts`

The stable route registry is intentionally not a universal inventory of every static/infrastructure URL today. The following current surfaces are dispatched outside it and therefore require an explicit Phase #628 decision instead of silent omission:

| Surface | Current owner | Current role in composition | Current #628 classification / requirement |
| --- | --- | --- | --- |
| `GET /health/dependencies` | `worker/dependency-health.ts` via `schema-migrations-entry.ts` | sanitized external FreeIPA/XYOps dependency state | classified as `dependency-health`; runtime still handles it pre-application |
| `/diagnostics/health`, `/diagnostics/health.js`, `/diagnostics/health.css` | `worker/health-diagnostics-ui.ts` via `schema-migrations-entry.ts` | schema-independent sanitized incident UI/assets with restrictive CSP | classified as diagnostics surfaces; runtime still handles them pre-application |
| `GET /metrics/health` | `worker/health-metrics.ts` via `schema-migrations-entry.ts` | low-cardinality projection of local health state | classified as `health-metrics`; runtime still handles it pre-application |
| `GET /api/maintenance/status` | `worker/maintenance-mode-gate.ts` via `security-composition.ts` | bounded public maintenance state | classified as `public-maintenance-status`; explicit maintenance gate remains handler |
| `/_vinext/image` | `worker/index.ts` | Vinext image optimization adapter | classified as `vinext-image`; Vinext owner remains handler |
| HTML application routes and ordinary static/RSC fallback | `worker/index.ts` -> Vinext handler | UI hosting / route-to-root compatibility behavior | classified as `framework`; preserve through #628 and move only under #635 |

A route missing from `portalRouteContracts` is **not automatically a bug**. Infrastructure/static routes have different ownership. `worker/application-router.ts` classifies the known supplemental surfaces explicitly, but classification alone does not move their handlers or security behavior.

## Hidden adaptation and coupling that must be retired only after parity

### Service-admin environment impersonation bridge

`worker/middleware/service-admin-authentication.ts` turns a valid service-admin token on supported local-mode admin integration paths into the same synthetic static identity environment (`service-admin@portal.local`, admin role/RBAC and `PORTAL_SERVICE_ADMIN_AUTHORIZED`) that the retired outer wrapper produced. This remains an adaptation shim, not a desired universal identity model. `worker/local-secure-entry.ts` still contains its route-specific service-admin fallback and must not be collapsed into this outer gate until the local-session/same-origin phase has independent parity proof.

### Local-session environment/header bridge

`worker/local-secure-entry.ts` resolves the local portal session, rewrites the delegated environment to a static identity/role, strips caller-provided `x-admin-token`, and for allowed admin integration paths inserts an internally derived admin token after the same-origin check. Downstream handlers therefore often observe trusted legacy headers/env rather than the original browser authentication mechanism.

### Canonical request context plus legacy identity headers

`worker/secure-entry.ts` sanitizes and re-emits trusted identity headers for workspace/proxy/static modes and constructs `resolvedAuthRequestContext`. Canonical request context is already available here, but lower legacy handlers still derive actor/role data from headers/env in several places.

### Settings effective-environment virtualization

`worker/settings-source-safe-entry.ts` can construct an effective integration environment by combining environment configuration with persisted `app_settings`. For inherited fields it proxies the D1 `prepare` path so downstream consumers see a virtual effective settings row. It also branches between source-aware and lifecycle downstream runtimes and owns source locking/compensation behavior.

### Safe execution-context compatibility

`worker/settings-source-context-entry.ts` supplies a compatibility `waitUntil` implementation when the incoming context does not provide one. This behavior must be classified before wrapper removal; it must not be lost accidentally as “just plumbing”.

These adapters explain why deleting remaining wrappers before #629–#635 would be unsafe. The target architecture should replace them with explicit principal/configuration/context dependencies, not merely move the same hidden mutation to different files.

## Current data and external-call ownership

The following ownership map is sufficient to navigate a route without treating the Worker wrapper as the domain source of truth:

- **Authentication/session:** `src/auth/**`; persistence in `portal_users` and `portal_sessions`.
- **Permissions/stable route metadata:** `src/auth/portal-permissions.ts` and `src/auth/portal-route-contract.ts`.
- **Settings:** existing settings lifecycle/source modules plus canonical schema; secrets remain encrypted server-side.
- **FreeIPA:** `src/freeipa/**` and private `scripts/freeipa-gateway.mjs`; browser code never owns credentials/session cookies.
- **XYOps:** server-side integration plus `src/operations/**`; portal records local history/policies/approvals, while XYOps owns upstream process execution.
- **Operations:** `operation_runs`, replay/result/notification persistence and existing `src/operations/run/**` owners.
- **Approvals/policies/presentation:** existing `src/operations/**` owners and their canonical tables.
- **Audit:** append-only audit owner and `portal_audit_events`; HTTP wrappers/handlers call it but do not own its schema.
- **Storage/schema/migrations:** `src/storage/**` and `db/**`; Worker files are HTTP adapters/gates.
- **Backup/recovery/maintenance:** `src/backup/**`, `src/recovery/**`, canonical schema/runbooks; destructive full restore remains offline.

## Scheduled and asset contracts

`scheduled` is not a second product scheduler. The current scheduled call enters through `schema-migrations-entry.ts`, is suppressed if schema is not ready, then delegates to `application.ts`. The application calls `security-composition.ts`, whose scheduled path deliberately bypasses the HTTP-only storage migration and service-admin gates and executes `handleMaintenanceScheduledGate` before delegating unchanged controller/environment/context directly to the remaining compatibility runtime. Ultimately `secure-entry.ts` owns the current portal-side catalog synchronization trigger and uses `ctx.waitUntil` to run it. XYOps remains owner of upstream process scheduling/execution.

Static/RSC/application assets are ultimately served by the Vinext handler in `worker/index.ts`; the same file also owns the current route-to-root HTML compatibility behavior and `/_vinext/image` optimization path. The #628 application router classifies framework/image traffic without taking over those handlers. Their final cleanup/integration belongs to #635.

## Current #628/#629 application-composition checkpoint

The current slices establish **one application composition point** plus the first three explicitly composed security gates:

1. `schema-migrations-entry.ts` remains the built entry and preserves infrastructure routes, bounded storage administration pass-through and ordinary schema readiness before ordinary application dispatch;
2. `application.ts` is the single HTTP application composition entry downstream of that boundary;
3. `application-router.ts` matches stable API metadata through the existing `portal-route-router.ts` and explicitly classifies known-path method mismatches, supplemental surfaces, unknown `/api/**` paths and framework traffic;
4. every classification enters `security-composition.ts` without mutating `Request`, environment or execution context;
5. `security-composition.ts` owns the controlled storage migration apply/status/reconcile gate through `middleware/storage-migration-apply.ts`; handled responses short-circuit before maintenance, while unrelated traffic keeps the same request/env/context identities;
6. the same composition point executes `maintenance-mode-gate.ts` for HTTP and scheduled work, preserving recovery allowlists, safe public status, health headers, fail-closed state-unavailable behavior and scheduled suppression before service-admin;
7. the outer service-admin gate is explicit in `middleware/service-admin-authentication.ts`, while local-session/settings/FreeIPA/operations/recovery compatibility paths remain authoritative for their remaining security enforcement, handler selection and returned status;
8. after downstream execution, `application-router.ts` canonicalizes only matching negative outcomes: `method-not-allowed + downstream 405` to `{ "error": "Method not allowed" }`, and `unknown-api + downstream 404` to `{ "error": "Not found" }`, preserving non-content headers and `cache-control: no-store`;
9. the finalizer never promotes `401`, `403`, legacy `404` for a method mismatch, `409`, `429`, `5xx`, success, stable, supplemental or framework responses into a routing error;
10. framework/static/RSC paths still reach the existing Vinext owner;
11. `scheduled` wiring stays explicit and separate from HTTP classification and both HTTP-only storage migration and service-admin gates.

This checkpoint deliberately does **not** move the 404/405 **status decision** ahead of security execution. Doing so before the remaining #629 security gates are explicit could bypass local-session/service-admin/same-origin ordering for protected wrong-method requests. Individual domain handlers also remain compatibility-owned until their route-family parity is proven.

The durable target and constraints remain captured in `docs/adr/ADR-0008-explicit-worker-application-composition.md`; ADR-0008 remains Proposed until the broader cutover evidence exists.

## Phase #628/#629 parity checklist

Before any additional existing wrapper becomes bypassable or removable, the candidate head must demonstrate all of the following:

- every `portalRouteContracts` entry resolves to exactly one registered handler/adaptor or an explicitly documented compatibility delegation;
- supplemental infrastructure/static surfaces above are classified explicitly;
- unknown API method/path behavior is deterministic and fail-closed; existing 404/405 behavior is preserved unless a separately reviewed contract change is intentional;
- public/local-session/admin-session/service-admin/admin-or-service-admin boundaries are unchanged;
- route permission, conditional permission, required-role, mutation and same-origin metadata agree with the actual enforcement path;
- local session and service-admin remain distinct authentication mechanisms;
- caller-supplied identity/admin headers cannot become trusted merely because dispatch moved;
- schema-gate exceptions, maintenance exceptions and scheduled suppression remain equivalent;
- FreeIPA credentials/Gateway token, XYOps API key, session cookies, encryption/recovery secrets and raw upstream bodies remain server-only/redacted;
- audit actor/correlation behavior remains stable for representative auth, settings, FreeIPA, XYOps/approval, backup and maintenance mutations;
- settings effective-source behavior and source locking remain equivalent;
- health/readiness/dependency/metrics distinctions remain equivalent;
- framework HTML/static/RSC/image behavior is still reachable;
- representative negative tests cover anonymous, viewer, operator, admin and service-admin access;
- `npm run lint`, `npm run build`, the complete discovered Node/server suite, documentation checks and current risk-routed CI/E2E checks are green.

The current checkpoint directly proves canonical stable-route classification, known-path method classification, supplemental/unknown/framework classification, unchanged composition inputs, storage migration short-circuit/pass-through parity, maintenance positive/negative/fail-closed semantics, exact maintenance HTTP/scheduled pass-through identity, service-admin missing/mismatched-token fail-closed behavior, local-mode/admin-path restriction, exact synthetic environment adaptation, ordinary request/env/context identity, security-preserving finalization for downstream 404/405 responses, preservation of non-content maintenance/correlation headers, and source-level schema/application/security ancestry. Authorization and stable handler-response parity continues to be proven by the existing full suite until later security/route-family cutovers add narrower direct dispatch tests.

## Confirmed risks and intentional unknowns

The following are confirmed migration risks:

- current authorization context is partly canonical and partly reconstructed from trusted legacy headers/env;
- service-admin and local-admin compatibility paths synthesize downstream identity/admin state;
- settings source behavior contains a real dispatch branch and DB/environment virtualization;
- catalog synchronization mixes identity adaptation, HTTP route ownership, persistence, audit and scheduled execution in `secure-entry.ts`;
- `worker/index.ts` combines framework hosting and several independent integration/operation domains;
- infrastructure/static surfaces are not all represented in the stable API metadata registry.

Remaining questions for later #629 slices must be answered from tests/current code rather than assumed:

- how to extract the next local-security slice without changing route-specific local-session/same-origin ordering or duplicating the remaining service-admin fallback;
- whether each supplemental infrastructure API belongs in canonical stable route metadata or should remain a separate infrastructure classification owned by application composition;
- when the negative **status decision** can move before compatibility dispatch without exposing route existence or bypassing existing auth behavior;
- the smallest handler registration API that avoids a new framework/DI/container dependency.

## Verification sources

Primary current evidence for this inventory:

- `src/auth/portal-route-contract.ts`
- `src/auth/portal-route-router.ts`
- `src/auth/portal-route-security-plan.ts`
- `worker/schema-migrations-entry.ts`
- `worker/application.ts`
- `worker/application-router.ts`
- `worker/security-composition.ts` and `worker/security-composition-contract.ts`
- `worker/middleware/storage-migration-apply.ts` and `worker/storage-migration-apply-entry.ts`
- `worker/maintenance-mode-gate.ts`
- `worker/middleware/service-admin-authentication.ts`
- `worker/local-secure-entry.ts`
- settings source/lifecycle/revision entry modules
- FreeIPA query/bulk/group-member entry modules
- `worker/secure-entry.ts`
- `worker/index.ts`
- canonical domain modules under `src/**`
- `db/portal-schema.ts`
- `tests/auth/portal-application-router.test.mjs`
- `tests/auth/security-composition-contract.test.mjs`
- `tests/storage/storage-migration-apply-security-gate.test.mjs`
- `tests/recovery/maintenance-gate.test.mjs`
- `tests/recovery/maintenance-composition-parity.test.mjs`
- route/auth/security tests under `tests/auth/**`
- FreeIPA tests under `tests/freeipa/**`
- operation/catalog/approval/health tests under `tests/operations/**`
- backup/recovery/storage/maintenance test families.

This inventory is intentionally updated as a current-state architecture artifact until #56 retires the wrapper-chain model.
