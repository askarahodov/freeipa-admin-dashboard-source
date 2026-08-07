# Portal Permissions Integration Plan

**Goal:** Remove the duplicate portal RBAC type/label definitions from `app/page.tsx` and consume the existing canonical `portal-permissions.ts` contract without changing behavior.

## Task 1 — RED contract

Create `tests/portal-permissions-ui-integration.test.mjs` that requires `app/page.tsx` to:
- import `PortalRole`, `PortalPermission` and `portalRoleLabels` from `../portal-permissions`;
- not declare local `type PortalRole`;
- not declare local `type PortalPermission`;
- not declare local `const roleLabels`;
- use `portalRoleLabels` for visible role labels.

Run the focused test and require RED on the current duplicate declarations.

## Task 2 — Minimal integration

Modify only `app/page.tsx`:
- add the canonical import;
- remove the two local type unions and local label map;
- replace `roleLabels[...]` reads with `portalRoleLabels[...]`.

Do not alter permission checks, `PortalAccess`, navigation, JSX structure, APIs or styling.

## Task 3 — Focused verification

Run the new integration contract plus existing portal permission/RBAC contracts. Require green.

## Task 4 — Repository verification

Open a draft PR and require exact-head:
- `PR Collision Guard / ownership-collision`;
- `CI / Required CI`;
- `Auth E2E / auth-e2e`.

Before merge, fresh-compare with `main`; if another PR has changed `app/page.tsx`, replay instead of forcing the merge.

## Task 5 — Merge

With 0 conflicting drift, no unresolved review threads and all required checks green, mark ready and squash-merge as the next #118 slice.