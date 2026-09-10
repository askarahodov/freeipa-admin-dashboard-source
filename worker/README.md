# Worker module

`worker/` contains server-facing entry adapters and bounded integration/operations endpoints for the portal.

## Responsibilities

- expose HTTP/domain entrypoints used by the built Worker/server contract;
- apply existing auth, authorization, same-origin, service-admin and maintenance boundaries before privileged domain actions;
- adapt health, diagnostics, recovery, storage and integration contracts to HTTP/runtime entrypoints.

## Application composition

`schema-migrations-entry.ts` remains the built Worker entry and owns pre-application health/schema readiness behavior. Schema-gated HTTP traffic delegates to `application.ts`, the explicit application composition boundary introduced by #628.

`application.ts` classifies requests through `application-router.ts`, which reuses the canonical matcher from `src/auth/portal-route-router.ts`; it does not define a second route registry. At the current migration checkpoint the resulting route decision is passed to the existing `maintenance-mode-root-entry.ts` compatibility runtime without rewriting the request, environment, context, authorization or response. Existing maintenance, service-admin, local-session and domain wrappers therefore remain authoritative until parity evidence supports incremental cutover.

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

Run the narrow worker/domain contract tests for the changed boundary. `tests/auth/portal-application-router.test.mjs` guards canonical route coverage, method/unknown classification, compatibility delegation and the explicit composition placement. Auth, permission, mutation or browser-observable routing changes normally require the relevant Auth E2E scope. Recovery/storage/health changes require their profile contract tests and runbook review.

Update normalized references only when the external contract changes; keep implementation details in their canonical source modules.
