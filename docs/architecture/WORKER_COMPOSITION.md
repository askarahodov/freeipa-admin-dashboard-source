# Worker HTTP composition and ownership inventory

## Purpose and evidence checkpoint

This document records the **current HTTP Worker composition** and the ownership boundaries that must remain intact while #56 replaces the historical wrapper chain with explicit application composition.

It is an ownership/integration map, not a second route registry. Exact stable method/path/auth/permission/mutation metadata remains canonical in `src/auth/portal-route-contract.ts`. `src/auth/portal-route-router.ts` and `src/auth/portal-route-security-plan.ts` are metadata-derived helpers; they do not dispatch requests or enforce security on the current runtime.

Evidence checkpoint for this inventory: `main` at `60c162e0d2c71b3a4fc061f3dce1147e0a119fbd` on 2026-09-10. At that checkpoint #640 owns trusted-proxy/runtime-host changes under `scripts/node-worker-host.mjs`, `scripts/trusted-proxy-policy.mjs` and their runtime tests. Those production-host concerns are intentionally outside this document's Worker refactor ownership.

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
    -> Worker wrapper/handler graph described below
    -> worker/index.ts
    -> Vinext application/static fallback
```

`runtime/**` and production-host scripts own listener/process/trusted-proxy hosting. `worker/**` owns the Worker-facing HTTP adapters, security gates and handler composition. Reverse-proxy trust policy remains #53 even while #56 changes application composition.

## Current request composition

### Top-level boundary

`worker/schema-migrations-entry.ts` is the current built Worker entry. Before delegating into the historical wrapper graph it handles infrastructure surfaces that intentionally work before the ordinary schema-gated application path:

- liveness/readiness and legacy health through `worker/health-contracts.ts`;
- dependency health through `worker/dependency-health.ts`;
- the sanitized health diagnostics document/assets through `worker/health-diagnostics-ui.ts`;
- health metrics through `worker/health-metrics.ts`;
- service-admin schema status;
- explicit storage status/integrity/migration paths that must reach their guarded downstream handlers;
- the schema readiness gate for ordinary requests;
- the same schema readiness boundary for `scheduled` execution.

### Normal downstream wrapper graph

For an ordinary request that reaches the historical chain, the verified downstream graph is:

```text
schema-migrations-entry.ts
  -> maintenance-mode-root-entry.ts
  -> service-admin-root-entry.ts
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

### Infrastructure and schema

`health.live`, `health.ready`, `integration.health.compat`, `schema.status`

Actual HTTP owners: `worker/health-contracts.ts` and `worker/schema-migrations-entry.ts`.

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

HTTP owners are the dedicated `worker/storage-*-entry.ts` adapters. Canonical schema remains in `db/**`; storage status/integrity/migration logic remains under `src/storage/**` and recovery/runtime owners where applicable.

### Maintenance administration

`maintenance.status`, `maintenance.prepare`, `maintenance.enter`, `maintenance.verification.start`, `maintenance.verification.smoke`, `maintenance.exit`, `maintenance.complete`, `maintenance.cancel`

HTTP ownership is in the maintenance control/verification adapters. Canonical maintenance state/repository logic remains under `src/recovery/maintenance/**`.

## Security and runtime ownership by route family

| Route family | Canonical auth/permission owner | Current HTTP enforcement/adaptation | Persistence / external owner | Audit and representative verification |
| --- | --- | --- | --- | --- |
| Health/schema | `portal-route-contract.ts`; schema status uses explicit service-admin boundary | `schema-migrations-entry.ts` handles health before ordinary schema gating and enforces schema status authorization | canonical schema/migrations under `db/**`; readiness probes private Gateway; dependency health may probe FreeIPA/XYOps | health/dependency contract tests, schema boundary tests |
| Local auth/users | local-auth/session/permission helpers under `src/auth/**` | `local-secure-entry.ts` owns login/logout/admin-user HTTP behavior, same-origin protection and downstream local-session delegation | `portal_users`, `portal_sessions`; no FreeIPA identity ownership | auth/RBAC/same-origin/request-context tests; audit for user administration and rate-limit denials |
| Settings | canonical permissions + route contract | settings lifecycle/source/revision wrappers plus base Worker; source-safe path has its own service-admin authorization | `app_settings`, settings drafts/revisions/apply/reset/source-lock state; encrypted integration secrets | settings lifecycle/source/revision tests; settings audit/compensation events |
| FreeIPA | canonical route permissions (`directory.read`, `freeipa.write`, conditional delete) | local session established before FreeIPA adapters/base Worker; wrapper-specific query/bulk/member handling | `src/freeipa/**` + private server-side FreeIPA Gateway; FreeIPA owns directory data | `tests/freeipa/**`, permission/route contract tests, operation/audit tests for mutations |
| XYOps/run/approval | canonical route metadata plus portal permissions | mostly `worker/index.ts`; approval/run checks remain in current handler/domain calls | portal operation/catalog/approval tables; server-side XYOps client; XYOps owns execution semantics | `tests/operations/**`, approval/run/catalog contracts, audit events from current handlers |
| Catalog sync | admin/service-admin route metadata | `secure-entry.ts` combines resolved identity context, HTTP handler and scheduler | `xyops_catalog_sync_lock`, `xyops_catalog_sync_runs`; live catalog fetch through current Worker/XYOps path | `tests/operations/catalog-scheduled-sync.test.mjs`, route/security-plan tests; `catalog.sync` audit |
| Backup/restore | canonical backup permissions and required admin role where declared | dedicated backup root/dispatch adapters plus local/service-admin delegation | canonical `src/backup/**`/`src/recovery/**`; DB/recovery metadata owned by canonical schema/domain modules | `tests/backup/**`, recovery/authorization/negative tests; guarded audit events |
| Storage | admin/service-admin route metadata | dedicated storage adapters; selected paths are intentionally reachable through the schema/maintenance boundaries | `src/storage/**`, `db/**` schema/migration owner, migration journals/locks | storage/migration/integrity contract and recovery tests |
| Maintenance | `maintenance.manage` / service-admin metadata | `maintenance-mode-root-entry.ts` + control/smoke adapters | `src/recovery/maintenance/**` and canonical maintenance persistence | maintenance positive/negative/recovery tests and audit contracts |

The table intentionally names persistence/domain owners rather than duplicating a complete schema table list. `db/portal-schema.ts` is authoritative for exact table shape.

## Maintenance and recovery gate semantics

`worker/maintenance-mode-root-entry.ts` wraps the downstream application with `handleMaintenanceGate` and `handleMaintenanceScheduledGate`.

Current behavior is fail-closed when maintenance state cannot be read. Ordinary `/api/**` traffic is rejected while maintenance is active. The following classes are intentionally reachable through the maintenance boundary so recovery can be controlled and diagnosed:

- maintenance control and verification routes;
- `/api/schema/status`;
- storage status, integrity and migration preflight;
- the public `/api/maintenance/status` compatibility/status surface;
- legacy health is allowed through with an `x-portal-maintenance-state` response header.

Non-API HTML/static traffic delegates through the gate. Scheduled work is suppressed unless maintenance is inactive (apart from the explicit test-bypass contract). Phase #628/#629 must preserve these distinctions rather than applying a blanket middleware order that blocks recovery control.

## Supplemental HTTP surfaces outside `portalRouteContracts`

The stable route registry is intentionally not a universal inventory of every static/infrastructure URL today. The following current surfaces are dispatched outside it and therefore require an explicit Phase #628 decision instead of silent omission:

| Surface | Current owner | Current role in composition | Phase #628 requirement |
| --- | --- | --- | --- |
| `GET /health/dependencies` | `worker/dependency-health.ts` via `schema-migrations-entry.ts` | sanitized external FreeIPA/XYOps dependency state | keep as explicit infrastructure route or deliberately add canonical metadata; do not create duplicate routing |
| `/diagnostics/health`, `/diagnostics/health.js`, `/diagnostics/health.css` | `worker/health-diagnostics-ui.ts` via `schema-migrations-entry.ts` | schema-independent sanitized incident UI/assets with restrictive CSP | preserve pre-schema availability and static content/security headers |
| `GET /metrics/health` | `worker/health-metrics.ts` via `schema-migrations-entry.ts` | low-cardinality projection of local health state | preserve no-external-probe behavior and method/error contract |
| `GET /api/maintenance/status` | `worker/maintenance-mode-gate.ts` | bounded public maintenance state | preserve fail-closed recovery visibility; decide registry classification explicitly |
| `/_vinext/image` | `worker/index.ts` | Vinext image optimization adapter | keep framework asset routing out of domain route metadata unless a separate contract is justified |
| HTML application routes and ordinary static/RSC fallback | `worker/index.ts` -> Vinext handler | UI hosting / route-to-root compatibility behavior | preserve through #628 and move only under the final scheduled/assets cleanup #635 |

A route missing from `portalRouteContracts` is **not automatically a bug**. Infrastructure/static routes have different ownership. The Phase #628 parity work must classify each explicitly so unknown protected API paths cannot disappear into a generic fallback.

## Hidden adaptation and coupling that must be retired only after parity

### Service-admin environment impersonation bridge

`worker/service-admin-root-entry.ts` currently turns a valid service-admin token on supported local-mode admin integration paths into a synthetic static identity environment (`service-admin@portal.local`, admin role/RBAC and `PORTAL_SERVICE_ADMIN_AUTHORIZED`). This is an adaptation shim, not a desired universal identity model.

### Local-session environment/header bridge

`worker/local-secure-entry.ts` resolves the local portal session, rewrites the delegated environment to a static identity/role, strips caller-provided `x-admin-token`, and for allowed admin integration paths inserts an internally derived admin token after the same-origin check. Downstream handlers therefore often observe trusted legacy headers/env rather than the original browser authentication mechanism.

### Canonical request context plus legacy identity headers

`worker/secure-entry.ts` sanitizes and re-emits trusted identity headers for workspace/proxy/static modes and constructs `resolvedAuthRequestContext`. Canonical request context is already available here, but lower legacy handlers still derive actor/role data from headers/env in several places.

### Settings effective-environment virtualization

`worker/settings-source-safe-entry.ts` can construct an effective integration environment by combining environment configuration with persisted `app_settings`. For inherited fields it proxies the D1 `prepare` path so downstream consumers see a virtual effective settings row. It also branches between source-aware and lifecycle downstream runtimes and owns source locking/compensation behavior.

### Safe execution-context compatibility

`worker/settings-source-context-entry.ts` supplies a compatibility `waitUntil` implementation when the incoming context does not provide one. This behavior must be classified before wrapper removal; it must not be lost accidentally as “just plumbing”.

These adapters explain why deleting wrappers before #629–#635 would be unsafe. The target architecture should replace them with explicit principal/configuration/context dependencies, not merely move the same hidden mutation to different files.

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

`scheduled` is not a second product scheduler. The current scheduled call enters through `schema-migrations-entry.ts`, is suppressed if schema is not ready, then passes through the maintenance scheduled gate. Ultimately `secure-entry.ts` owns the current portal-side catalog synchronization trigger and uses `ctx.waitUntil` to run it. XYOps remains owner of upstream process scheduling/execution.

Static/RSC/application assets are ultimately served by the Vinext handler in `worker/index.ts`; the same file also owns the current route-to-root HTML compatibility behavior and `/_vinext/image` optimization path. #628 must keep those paths working while explicit API composition is introduced. Their final cleanup/integration belongs to #635, not the first router cutover.

## Proposed migration boundary for #628

The next phase should create **one application composition point** in `worker/**` that:

1. resolves infrastructure routes that must work before the ordinary schema/application gate;
2. applies schema and maintenance/recovery gating with explicit exceptions;
3. matches stable API metadata through the existing `portal-route-router.ts` rather than a new route registry;
4. derives an ordered security plan from existing canonical metadata but keeps current enforcement authoritative until negative/parity tests prove replacement;
5. registers current HTTP adapters/handlers explicitly by route/domain family;
6. delegates framework/static/RSC paths to the existing Vinext owner;
7. keeps `scheduled` wiring explicit and separate from HTTP route registration;
8. allows legacy wrappers to remain thin compatibility adapters until their unique behavior has an explicit replacement.

The durable target and constraints are captured in `docs/adr/ADR-0008-explicit-worker-application-composition.md`.

## Phase #628 parity checklist

Before any existing wrapper becomes bypassable or removable, Phase #628 must demonstrate all of the following on the candidate head:

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

## Confirmed risks and intentional unknowns

The following are confirmed migration risks, not implementation instructions for #627:

- current authorization context is partly canonical and partly reconstructed from trusted legacy headers/env;
- service-admin and local-admin compatibility paths synthesize downstream identity/admin state;
- settings source behavior contains a real dispatch branch and DB/environment virtualization;
- catalog synchronization mixes identity adaptation, HTTP route ownership, persistence, audit and scheduled execution in `secure-entry.ts`;
- `worker/index.ts` combines framework hosting and several independent integration/operation domains;
- infrastructure/static surfaces are not all represented in the stable API metadata registry.

Open questions for #628 must be answered from tests/current code rather than assumed:

- which compatibility wrappers can delegate immediately to explicit composition and which still own unique semantics;
- whether each supplemental infrastructure API belongs in the canonical stable route metadata or should remain a separate infrastructure registry owned by the application composition;
- the exact preserved 404/405 behavior for overlapping dynamic/static paths after central matching;
- the smallest handler registration API that avoids a new framework/DI/container dependency.

## Verification sources

Primary current evidence for this inventory:

- `src/auth/portal-route-contract.ts`
- `src/auth/portal-route-router.ts`
- `src/auth/portal-route-security-plan.ts`
- `worker/schema-migrations-entry.ts`
- `worker/maintenance-mode-root-entry.ts` and `worker/maintenance-mode-gate.ts`
- `worker/service-admin-root-entry.ts`
- `worker/local-secure-entry.ts`
- settings source/lifecycle/revision entry modules
- FreeIPA query/bulk/group-member entry modules
- `worker/secure-entry.ts`
- `worker/index.ts`
- canonical domain modules under `src/**`
- `db/portal-schema.ts`
- route/auth/security tests under `tests/auth/**`
- FreeIPA tests under `tests/freeipa/**`
- operation/catalog/approval/health tests under `tests/operations/**`
- backup/recovery/storage/maintenance test families.

This inventory is intentionally updated as a current-state architecture artifact until #56 retires the wrapper-chain model.