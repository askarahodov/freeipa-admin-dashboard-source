# Machine-readable API route contract design

## Context

Admin Dashboard Softrust currently owns HTTP routing through a distributed Worker wrapper chain plus route-specific handlers and contract constants. `docs/reference/API.md` normalizes that current surface for humans and AI agents, but it is not machine-readable and is not a runtime owner.

Issue #121 introduces one typed route metadata contract that can be consumed by tests and documentation tooling. It must **not** become a second router and must not change effective API behavior. The later router/middleware refactor remains owned by #56.

## Goals

1. Establish one machine-readable inventory for supported portal HTTP routes.
2. Describe each route with enough static metadata to verify ownership and security boundaries.
3. Detect duplicate static method/path contracts.
4. Give `docs/reference/API.md` a stable drift-verification input.
5. Prepare #56 by producing the route/security inventory it requires before wrapper removal.
6. Preserve every existing handler, route, auth rule and response contract during this migration.

## Non-goals

- No endpoint addition, removal or rename.
- No request dispatcher/router replacement.
- No middleware-order change.
- No RBAC/auth/service-admin semantic change.
- No request/response schema duplication.
- No OpenAPI requirement in this slice.
- `/api/integrations/routes` remains XYOps/portal automation-routing configuration; it is not the HTTP registry.

## Chosen approach

Create a focused root-level module `portal-route-contract.ts` that exports typed declarative metadata only. Existing Worker handlers remain runtime owners and do not dispatch through this registry in #121.

This is preferred over embedding metadata inside every wrapper because the current wrapper chain is intentionally temporary and #56 will reorganize it. A standalone metadata owner gives tests/docs a stable contract now while avoiding a second execution path.

## Contract model

The contract uses literal method/path patterns and bounded enums rather than handler functions.

```ts
export type PortalRouteMethod = "GET" | "POST" | "PUT" | "DELETE";

export type PortalRouteAuthBoundary =
  | "public"
  | "local-session"
  | "admin-session"
  | "service-admin"
  | "admin-or-service-admin";

export type PortalRouteMutation = "read" | "mutation";

export type PortalRouteContract = {
  id: string;
  method: PortalRouteMethod;
  path: string;
  owner: string;
  auth: PortalRouteAuthBoundary;
  permission?: PortalPermission;
  mutation: PortalRouteMutation;
  sameOrigin: boolean;
  errorOwner?: string;
};
```

`path` is a normalized pattern such as `/api/auth/users/:userId` rather than a regular expression. Dynamic placeholders are descriptive metadata; this slice does not introduce a matcher used for request dispatch.

`owner` is a repository path identifying the current handler/domain owner. It is not an import or executable callback.

`permission` may reference only canonical `PortalPermission` values from `portal-permissions.ts`. Service-admin-only routes omit portal permission metadata rather than pretending service authorization is RBAC.

## Initial route inventory scope

The first registry must cover the current supported families already normalized by `docs/reference/API.md`:

- health/readiness/dependency/metrics;
- local auth/users/sessions/diagnostics;
- settings/drafts/revisions/audit;
- FreeIPA users/groups/members/actions/bulk/export;
- XYOps catalog/options/run and portal automation-routing configuration;
- approvals;
- runs/cancel/rerun/files;
- notifications;
- backup/export/preview/test/selective restore;
- storage status/integrity/migrations;
- schema status;
- maintenance control.

Where an exact method is intentionally owned only by a handler and current documentation says `route-owned`, inventory work must verify the handler/test before choosing the literal method. No method will be inferred from naming alone.

## Security semantics

The registry documents static security classification but never performs authorization.

Rules:

1. `permission` must come from canonical `portal-permissions.ts`.
2. `service-admin` remains distinct from `admin-session`.
3. `admin-or-service-admin` is used only where the current wrapper chain explicitly supports that delegation.
4. `sameOrigin=true` is declared only for existing protected mutation paths with a verified same-origin guard.
5. Dynamic approval, maintenance-state, restore-stage and catalog-policy decisions remain in domain handlers and tests; the registry may describe only the stable outer boundary.
6. UI visibility is never represented as authorization.

## Verification strategy

### Contract integrity

Tests will assert:

- unique `id` values;
- no duplicate `method + path` pairs;
- path begins with `/` and dynamic placeholders use `:name` syntax;
- reads do not claim same-origin mutation protection;
- permission values are canonical;
- service-admin-only entries do not claim portal permissions;
- every contract has a current owner path.

### Runtime parity

#121 will not attempt to prove all routing through source-text scraping. Instead, focused parity tests will cover representative static route constants/known handlers from each domain and fail when registered metadata points at an absent owner or known literal route changes without updating the registry.

Complete runtime dispatch centralization is deferred to #56.

### Documentation drift

`tests/documentation-reference-layer.test.mjs` will consume the route contract so `docs/reference/API.md` is verified against registered method/path patterns rather than manually scraping `worker/index.ts`.

## File ownership

- `portal-route-contract.ts` — canonical machine-readable route metadata.
- `tests/portal-route-contract.test.mjs` — registry integrity and representative runtime parity.
- `docs/reference/API.md` — human-readable normalized view; not runtime owner.
- `tests/documentation-reference-layer.test.mjs` — docs-to-registry drift guard.
- `docs/SOURCE_OF_TRUTH.md` — updated because #121 introduces a new canonical contract owner.
- `docs/ARCHITECTURE.md` / `docs/PROJECT_STRUCTURE.md` — only minimal ownership wording if required; no wrapper-chain refactor claim.

## Migration and compatibility

This is additive metadata. Existing request handling remains untouched. Rollback is removal of the registry/tests/docs-owner entry; no API/data migration is required.

#56 may later consume this contract as input to a real router migration, but that future use must be deliberate and separately tested. This design does not make the current Worker dispatch depend on the registry.

## Acceptance mapping

- one machine-readable owner: `portal-route-contract.ts`;
- actual owner pointers: required `owner` field;
- duplicate detection: contract integrity test;
- auth/permission/service-admin classification: typed fields and security invariants;
- docs verification without monolith scraping: reference-layer guard consumes registry;
- no effective API change: no runtime dispatcher imports registry in this slice;
- #56 compatibility: registry is metadata-only and supplies its mandatory pre-refactor route inventory.
