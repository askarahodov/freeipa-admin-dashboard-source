# Worker module

`worker/` contains server-facing entry adapters and bounded integration/operations endpoints for the portal.

## Responsibilities

- expose HTTP/domain entrypoints used by the built Worker/server contract;
- apply existing auth, authorization, same-origin, service-admin and maintenance boundaries before privileged domain actions;
- adapt health, diagnostics, recovery, storage and integration contracts to HTTP/runtime entrypoints.

## Application composition

`schema-migrations-entry.ts` remains the built Worker entry and owns pre-application health/schema readiness behavior. Schema-gated HTTP traffic delegates to `application.ts`, the explicit application composition boundary introduced by #628.

`application.ts` classifies requests through `application-router.ts`, which reuses the canonical matcher from `src/auth/portal-route-router.ts`; it does not define a second route registry. The existing `maintenance-mode-root-entry.ts` compatibility runtime still receives the original request, environment and context and remains authoritative for maintenance, authentication, authorization and stable-route handlers.

For negative route classifications, the application now owns a deliberately narrow final response boundary **after** compatibility execution: a known method mismatch is normalized only when downstream already returned `405`, and an unknown `/api/**` route is normalized only when downstream already returned `404`. The application preserves downstream security/maintenance denials and does not promote `401`, `403`, `409`, `429`, `5xx` or legacy `404` responses into `405`. Existing response headers such as correlation or maintenance state are retained, while the outward negative API envelope is canonical JSON with `cache-control: no-store`. This preserves the current security order until #629 makes security composition explicit.

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

Run the narrow worker/domain contract tests for the changed boundary. `tests/auth/portal-application-router.test.mjs` guards canonical route coverage, method/unknown classification, unchanged compatibility delegation, security-preserving negative response finalization and the explicit composition placement. Auth, permission, mutation or browser-observable routing changes normally require the relevant Auth E2E scope. Recovery/storage/health changes require their profile contract tests and runbook review.

Update normalized references only when the external contract changes; keep implementation details in their canonical source modules.
