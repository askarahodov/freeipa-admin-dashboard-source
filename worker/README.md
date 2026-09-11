# Worker module

`worker/` contains server-facing entry adapters and bounded integration/operations endpoints for the portal.

## Responsibilities

- expose HTTP/domain entrypoints used by the built Worker/server contract;
- apply existing auth, authorization, same-origin, service-admin and maintenance boundaries before privileged domain actions;
- adapt health, diagnostics, recovery, storage and integration contracts to HTTP/runtime entrypoints.

## Application composition

`schema-migrations-entry.ts` remains the built Worker entry and owns pre-application health/schema readiness behavior. Schema-gated HTTP traffic delegates to `application.ts`, the explicit application composition boundary introduced by #628.

`application.ts` classifies requests through `application-router.ts`, which reuses the canonical matcher from `src/auth/portal-route-router.ts`; it does not define a second route registry. The router exposes four explicit dispatch registrations: `stable`, `negative`, `supplemental` and `framework`.

Starting with #629, all four registrations enter compatibility security execution through `security-composition.ts` instead of importing a concrete legacy wrapper directly. `security-composition.ts` is the single application-facing migration seam and publishes the ordered security-gate contract that subsequent slices must preserve: storage-migration apply, maintenance restrictions, service-admin authentication/adaptation, local-session authentication, mutation-origin protection, route/domain authorization, then existing audit/error handling. The contract also keeps `anonymous`, `local-session` and `service-admin` as distinct authentication mechanisms.

This first #629 checkpoint does **not** reorder or reimplement those gates. `security-composition.ts` delegates request, environment and context unchanged to `maintenance-mode-root-entry.ts`, so the compatibility runtime remains the execution authority. A gate may move into explicit middleware only together with focused parity/negative evidence; do not create a second principal/context, default-admin path, or universal service-token bypass while migrating it.

For negative route classifications, the application owns a deliberately narrow final response boundary **after** compatibility execution: a known method mismatch is normalized only when downstream already returned `405`, and an unknown `/api/**` route is normalized only when downstream already returned `404`. The application preserves downstream security/maintenance denials and does not promote `401`, `403`, `409`, `429`, `5xx` or legacy `404` responses into `405`. Existing response headers such as correlation or maintenance state are retained, while the outward negative API envelope is canonical JSON with `cache-control: no-store`.

Supplemental infrastructure surfaces that intentionally execute before ordinary schema-gated application dispatch remain owned by `schema-migrations-entry.ts`. Framework/static/RSC/image handling remains downstream in the existing Vinext owner. Scheduled execution is delegated through the compatibility runtime separately from HTTP route classification.

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

Run the narrow worker/domain contract tests for the changed boundary. `tests/auth/portal-application-router.test.mjs` guards canonical route coverage and application routing parity. `tests/auth/security-composition-contract.test.mjs` guards the ordered security migration contract, the application-facing seam, distinct local-session/service-admin mechanisms, the current maintenance/service-admin wrapper edge, same-origin ownership and absence of a new admin/principal adaptation in the seam. Auth, permission, mutation or browser-observable routing changes normally require the relevant Auth E2E scope. Recovery/storage/health changes require their profile contract tests and runbook review.

Update normalized references only when the external contract changes; keep implementation details in their canonical source modules.
