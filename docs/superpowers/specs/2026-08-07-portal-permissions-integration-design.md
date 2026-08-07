# Portal Permissions Integration Design

## Context

Issue #118 requires behavior-preserving decomposition of `app/page.tsx`. The repository already has a canonical RBAC contract in `portal-permissions.ts`, including `PortalRole`, `PortalPermission` and `portalRoleLabels`, but `app/page.tsx` still redeclares all three concepts locally.

That duplication creates a second UI-side source of truth. It is already incomplete: the canonical permission union has backup/restore/maintenance permissions that the local page union does not know about.

## Goal

Make `app/page.tsx` consume the canonical portal role/permission types and labels without changing authorization decisions, visible navigation, API requests, UI copy or behavior.

## Scope

Included:
- import `PortalRole`, `PortalPermission` and `portalRoleLabels` from `../portal-permissions`;
- remove the duplicate local role and permission unions;
- remove the duplicate local `roleLabels` object;
- replace UI references to `roleLabels` with `portalRoleLabels`;
- add a focused source integration contract.

Excluded:
- changing `PortalAccess` shape;
- changing role permissions or policy semantics;
- exposing additional backup/restore UI;
- changing RBAC checks, server authorization, routes, navigation or styling;
- moving more types/components out of `app/page.tsx` in this slice.

## Behavioral invariants

- viewer/operator/admin display labels remain exactly `Наблюдатель`, `Оператор`, `Администратор`;
- existing `integration.access.permissions.includes(...)` checks remain unchanged;
- settings/audit visibility remains unchanged;
- FreeIPA write/delete and XYOps run/approve UI gating remains unchanged;
- no permission is granted client-side by this refactor.

## Verification

RED: a source integration test must fail while `app/page.tsx` still declares `type PortalRole`, `type PortalPermission` and `const roleLabels`.

GREEN:
- page imports canonical RBAC types/labels;
- duplicate declarations are absent;
- existing portal-permissions behavior tests stay green;
- full CI, Auth E2E and Collision Guard pass on one exact head.

This is a narrow #118 decomposition slice and also reduces duplicate ownership relevant to #119 without changing #119 semantics.