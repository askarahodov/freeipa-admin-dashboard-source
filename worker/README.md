# Worker module

`worker/` contains server-facing entry adapters and bounded integration/operations endpoints for the portal.

## Responsibilities

- expose HTTP/domain entrypoints used by the built Worker/server contract;
- apply existing auth, authorization, same-origin, service-admin and maintenance boundaries before privileged domain actions;
- adapt health, diagnostics, recovery, storage and integration contracts to HTTP/runtime entrypoints.

## Application composition

`schema-migrations-entry.ts` remains the built Worker entry and owns pre-application health/schema readiness behavior. Schema-gated HTTP traffic delegates to `application.ts`, the explicit application composition boundary introduced by #628.

`application.ts` classifies requests through `application-router.ts`, which reuses the canonical matcher from `src/auth/portal-route-router.ts`; it does not define a second route registry. The router exposes four explicit dispatch registrations: `stable`, `negative`, `supplemental` and `framework`.

Starting with #629, all four registrations enter security execution through `security-composition.ts` instead of importing a concrete legacy wrapper directly. `security-composition.ts` is the single application-facing runtime migration seam. The pure, runtime-import-free `security-composition-contract.ts` publishes the universal **outer** migration order: storage-migration apply, maintenance restrictions, outer service-admin authentication/adaptation, local-security routing, route/domain authorization, then existing audit/error handling. The contract also keeps `anonymous`, `local-session` and `service-admin` as distinct authentication mechanisms.

Checkpoint 2 made `storage-migration-apply` the first gate that is no longer compatibility-owned. Checkpoint 3 moves the existing dependency-injected maintenance HTTP and scheduled gates into the same explicit composition point. The active outer execution order is therefore now `storage migration apply -> maintenance -> service-admin`: controlled migration apply/status/reconcile still short-circuit before maintenance; maintenance preserves its recovery allowlist, public status, integration-health maintenance header, fail-closed state-read behavior and scheduled suppression; only traffic that passes those gates reaches `service-admin-root-entry.ts`. The canonical storage migration and maintenance gate implementations remain unchanged.

Local security ordering is deliberately **not** represented as one universal authentication-before-origin pipeline. The compatibility runtime has route-specific semantics that #629 must preserve: local `/api/auth/**` mutations validate same-origin before administrator session authorization (and logout does not require `requireAdmin`), while an already authenticated local administrator reaching an integration path resolves the session before same-origin validation and internal-token delegation. A missing local session reaches the allowlisted service-admin fallback before ordinary API denial. `security-composition-contract.ts` records these local order profiles explicitly so later middleware extraction cannot silently change 401/403 behavior.

Keeping the metadata contract separate from the runtime seam remains intentional: architecture/parity tests can execute the contract without loading the entire legacy Worker graph. Each following gate may move into explicit middleware only together with focused parity/negative evidence; do not create a second principal/context, default-admin path, or universal service-token bypass while migrating it.

For negative route classifications, the application owns a deliberately narrow final response boundary **after** security execution: a known method mismatch is normalized only when downstream already returned `405`, and an unknown `/api/**` route is normalized only when downstream already returned `404`. The application preserves downstream security/maintenance denials and does not promote `401`, `403`, `409`, `429`, `5xx` or legacy `404` responses into `405`. Existing response headers such as correlation or maintenance state are retained, while the outward negative API envelope is canonical JSON with `cache-control: no-store`.

Supplemental infrastructure surfaces that intentionally execute before ordinary schema-gated application dispatch remain owned by `schema-migrations-entry.ts`. Framework/static/RSC/image handling remains downstream in the existing Vinext owner. Scheduled execution bypasses HTTP classification but now enters the explicit maintenance scheduled gate in `security-composition.ts` before delegating to the remaining compatibility runtime.

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

Run the narrow worker/domain contract tests for the changed boundary. `tests/auth/portal-application-router.test.mjs` guards canonical route coverage and application routing parity. `tests/auth/security-composition-contract.test.mjs` guards the outer-order and route-specific local security contracts plus explicit/compatibility ownership. `tests/storage/storage-migration-apply-security-gate.test.mjs` proves storage short-circuit and exact pass-through behavior. `tests/recovery/maintenance-gate.test.mjs` owns maintenance positive/negative semantics, while `tests/recovery/maintenance-composition-parity.test.mjs` proves exact HTTP/scheduled pass-through identity and active-state short-circuit for the gate now executed by composition. Existing storage migration and maintenance API/RBAC/recovery tests remain behavioral authority. Auth, permission, mutation or browser-observable routing changes normally require the relevant Auth E2E scope. Recovery/storage/health changes require their profile contract tests and runbook review.

Update normalized references only when the external contract changes; keep implementation details in their canonical source modules.
