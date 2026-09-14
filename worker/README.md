# Worker module

`worker/` contains server-facing entry adapters and bounded integration/operations endpoints for the portal.

## Responsibilities

- expose HTTP/domain entrypoints used by the built Worker/server contract;
- apply existing auth, authorization, same-origin, service-admin and maintenance boundaries before privileged domain actions;
- adapt health, diagnostics, recovery, storage and integration contracts to HTTP/runtime entrypoints.

## Application composition

`schema-migrations-entry.ts` remains the built Worker entry and owns ordinary schema readiness plus the explicit pre-schema pass-through required by infrastructure health routes. It no longer dispatches those health handlers itself. Schema-gated traffic and pre-schema health pass-through both delegate to `application.ts`, the explicit application composition boundary introduced by #628.

`application.ts` classifies requests through `application-router.ts`, which reuses the canonical matcher from `src/auth/portal-route-router.ts`; it does not define a second route registry. The router exposes four explicit dispatch registrations: `stable`, `negative`, `supplemental` and `framework`. The #630 pilot registers `health-http.ts` from the stable, negative and supplemental registrations. `health-http.ts` is now the single HTTP adapter for stable liveness/readiness/legacy health, dependency health, the sanitized health diagnostics document/assets and health metrics. Its pure pre-schema predicate consumes the same application classification, so the schema exception and actual dispatch cannot drift into independent route lists.

Starting with #629, non-health registrations enter security execution through `security-composition.ts` instead of importing a concrete legacy wrapper directly. `security-composition.ts` is the single application-facing runtime migration seam. The pure, runtime-import-free `security-composition-contract.ts` publishes the universal **outer** migration order: storage-migration apply, maintenance restrictions, outer service-admin authentication/adaptation, local-security routing, route/domain authorization, then existing audit/error handling. The contract also keeps `anonymous`, `local-session` and `service-admin` as distinct authentication mechanisms.

Checkpoint 2 made `storage-migration-apply` the first gate that is no longer compatibility-owned. Checkpoint 3 moved the existing dependency-injected maintenance HTTP and scheduled gates into the same explicit composition point. Checkpoint 4 moved the outer service-admin authentication/adaptation boundary into `middleware/service-admin-authentication.ts`. Checkpoint 5A characterized the historical local-security decision tree, and checkpoint 5B wires that proven tree through `middleware/local-security-routing.ts` from `local-secure-entry.ts` without moving it above pre-local compatibility adapters. The outer application order remains `storage migration apply -> maintenance -> service-admin -> maintenance-control compatibility`: migration responses still short-circuit before maintenance; maintenance preserves its recovery allowlist, public status, integration-health maintenance header and fail-closed state-read behavior; the service-admin gate then preserves local-mode restriction, canonical admin-path allowlisting, constant-time token authorization and the exact synthetic static admin environment. Scheduled execution still goes through maintenance and then directly to compatibility, matching the retired service-admin wrapper's scheduled pass-through. The canonical migration, maintenance and token-authorization helpers remain unchanged.

Local security ordering is deliberately **not** represented as one universal authentication-before-origin pipeline. `middleware/local-security-routing.ts` now owns the ordinary local-session/service-admin-fallback/origin routing at the historical adapter position, while `local-secure-entry.ts` retains `/api/auth/**` handling. The route-specific semantics remain: local `/api/auth/**` mutations validate same-origin before administrator session authorization (and logout does not require `requireAdmin`), while an already authenticated local administrator reaching an integration path resolves the session before same-origin validation and internal-token delegation. A missing local session reaches the allowlisted service-admin fallback before ordinary API denial. `security-composition-contract.ts` records these local order profiles explicitly so later middleware extraction cannot silently change 401/403 behavior.

Keeping the metadata contract separate from the runtime seam remains intentional: architecture/parity tests can execute the contract without loading the entire legacy Worker graph. Each following gate may move into explicit middleware only together with focused parity/negative evidence; do not create a second principal/context, default-admin path, or universal service-token bypass while migrating it.

For negative route classifications, health-owned method mismatches keep their existing handler-specific `405` contract before generic negative finalization. Every other negative classification uses the deliberately narrow final response boundary **after** security execution: a known method mismatch is normalized only when downstream already returned `405`, and an unknown `/api/**` route is normalized only when downstream already returned `404`. The application preserves downstream security/maintenance denials and does not promote `401`, `403`, `409`, `429`, `5xx` or legacy `404` responses into `405`. Existing response headers such as correlation or maintenance state are retained, while the outward negative API envelope is canonical JSON with `cache-control: no-store`.

Health infrastructure remains reachable before ordinary schema gating and before security composition, matching its historical availability contract, but actual handler ownership is no longer hidden in `schema-migrations-entry.ts`. `health-http.ts` owns the public/infrastructure health dispatch from application composition; the schema entry only passes matching canonical application classifications through before readiness checks. Local administrator diagnostics (`/api/auth/diagnostics` and `/diagnostics`) remain a separate compatibility adapter concern in `diagnostics-entry.ts` and are not part of the public health surface. Framework/static/RSC/image handling remains downstream in the existing Vinext owner. Scheduled execution bypasses HTTP classification but now enters the explicit maintenance scheduled gate in `security-composition.ts` before delegating to the remaining compatibility runtime.

## Non-responsibilities

- do not define a second permission registry, route registry, schema registry or configuration registry;
- do not expose FreeIPA credentials, Gateway credentials, service tokens or recovery secrets to browser code;
- do not bypass canonical domain/security owners merely because an entrypoint is easier to change here.

## Canonical references

- `docs/reference/API.md`
- `docs/reference/PERMISSIONS.md`
- `docs/reference/ERROR_CODES.md`
- `docs/security/SECURITY_MODEL.md`
- `docs/reference/SOURCE_OF_TRUTH.md`
- `docs/architecture/WORKER_COMPOSITION.md`
- profile runbooks for backup/restore, maintenance, storage and health.

## Verification

Run the narrow worker/domain contract tests for the changed boundary. `tests/auth/portal-application-router.test.mjs` guards canonical route coverage and application routing parity. `tests/runtime/health-http-owner.test.mjs` guards the #630 application-owned health classifications, pre-schema pass-through, handler-specific method errors, liveness/readiness/dependency separation, diagnostics CSP and metrics behavior. The existing health, diagnostics and metrics routing/behavior contracts remain authoritative for their public surfaces. `tests/auth/security-composition-contract.test.mjs` guards the outer-order and route-specific local security contracts plus explicit/compatibility ownership, while `tests/auth/local-security-routing.test.mjs` is the executable negative/parity matrix for the extracted local boundary. `tests/storage/storage-migration-apply-security-gate.test.mjs` proves storage short-circuit and exact pass-through behavior. `tests/recovery/maintenance-gate.test.mjs` owns maintenance positive/negative semantics, while `tests/recovery/maintenance-composition-parity.test.mjs` proves exact HTTP/scheduled pass-through identity and active-state short-circuit for the gate now executed by composition. Existing storage migration and maintenance API/RBAC/recovery tests remain behavioral authority. Auth, permission, mutation or browser-observable routing changes normally require the relevant Auth E2E scope. Recovery/storage/health changes require their profile contract tests and runbook review.

Update normalized references only when the external contract changes; keep implementation details in their canonical source modules.
