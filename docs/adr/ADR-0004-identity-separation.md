# ADR-0004: Separate portal authentication identity from FreeIPA operation identity

- Status: Accepted
- Date: 2026-08-27
- Decision owner: authentication, authorization and FreeIPA integration boundaries

## Context

The dashboard has its own authenticated portal session and RBAC model while FreeIPA operations may require separate upstream identity/session material. Treating those identities as interchangeable would couple portal login semantics to an external directory session, expand credential exposure and make authorization ownership ambiguous.

## Decision

Portal authentication/authorization identity and FreeIPA operation identity are separate concepts.

Portal sessions determine who is using the dashboard and which portal permissions apply. FreeIPA credentials/session material are integration-side secrets used only to perform permitted upstream operations. Possessing or establishing a FreeIPA session does not create a portal session or bypass portal RBAC, and portal session material is not forwarded as FreeIPA credentials.

Authorization remains server-side at the portal boundary before an upstream FreeIPA operation is attempted.

## Consequences

Positive:

- portal RBAC remains the explicit authorization owner;
- upstream FreeIPA credential/session handling can evolve without redefining portal login semantics;
- secrets stay confined to the appropriate trust boundary;
- audit events can distinguish portal actor identity from upstream integration execution.

Constraints:

- UI state must not infer authorization from FreeIPA connectivity alone;
- integration failures must not silently weaken portal authorization;
- any future SSO/federation design that intentionally unifies these identities requires a new ADR and migration/security review.

## Canonical evidence / owners

- `docs/SECURITY_MODEL.md` — portal authentication, authorization and integration trust boundaries;
- `docs/reference/PERMISSIONS.md` and canonical portal permission definitions — portal RBAC;
- portal auth/session modules and their contract tests;
- FreeIPA Gateway/client modules and their contract tests;
- audit domain/tests where actor and integration activity are recorded.

## Supersession

No prior ADR is superseded. A future identity federation design that intentionally changes this separation must supersede this ADR explicitly.
