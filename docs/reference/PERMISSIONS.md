# Permissions reference

## Purpose

This document is the normalized **current-state permission reference** for Admin Dashboard Softrust. It explains the built-in portal roles, canonical permission codes and capability families without creating a second RBAC implementation.

The runtime source of truth for built-in roles and canonical permission codes is [`../../portal-permissions.ts`](../../portal-permissions.ts). Server-side authorization remains authoritative; UI visibility is not an authorization boundary.

## Built-in roles

The current built-in roles are:

| Role | Meaning | Canonical built-in permissions |
| --- | --- | --- |
| `viewer` | Read-only portal user | `directory.read` |
| `operator` | Operational user allowed to change ordinary FreeIPA objects and launch XYOps processes | `directory.read`, `freeipa.write`, `xyops.run` |
| `admin` | Full built-in portal administrator | all canonical permissions listed below |

Role labels and the exact role-to-permission arrays are owned by `portal-permissions.ts`.

## Canonical permissions

| Permission | Capability family | Canonical intent |
| --- | --- | --- |
| `directory.read` | Portal / directory read | Read FreeIPA users/groups, automation catalog, portal operations and results. |
| `freeipa.write` | FreeIPA mutation | Create/update users and groups, membership, password and enabled/disabled state. |
| `freeipa.delete` | FreeIPA destructive mutation | Delete FreeIPA users and groups. |
| `xyops.run` | XYOps execution | Run allowed Events/Workflows, stop supported executions and perform safe replay where implemented. |
| `xyops.approve` | XYOps approval | Approve or reject processes protected by approval policies. |
| `settings.manage` | Portal administration | Manage portal settings, audit/policy/metadata/diagnostic/admin-user/session surfaces that use this administrative capability. |
| `backup.export` | Sanitized backup | Create the supported sanitized backup/export without secrets. |
| `backup.export.encrypted` | Encrypted full backup | Create the supported full encrypted backup using the separate backup key boundary. |
| `backup.restore.preview` | Restore preview | Perform the supported read-only backup restore preview before test or production restore. This capability is built-in `admin` only. |
| `backup.restore.test` | Isolated restore | Test restore selected backup data in an isolated temporary database. |
| `backup.restore.prepare` | Selective restore preparation | Preflight selective restore, create the required recovery point and stage a guarded restore. |
| `backup.restore.commit` | Selective restore commit | Apply a prepared selective restore after the required revalidation and confirmation gates. |
| `backup.restore.cancel` | Selective restore cancellation | Cancel a prepared restore stage before commit. |
| `maintenance.manage` | Maintenance / recovery | Prepare, enter, inspect and safely exit supported maintenance/recovery mode. |

The descriptions above normalize the canonical metadata in `portal-permissions.ts`; exact route enforcement still belongs to the relevant server handler/wrapper and tests.

## Effective authorization model

### Server-side authorization is authoritative

A control being visible or hidden in React is only UX. Protected server handlers must enforce the effective role/permission boundary independently of the UI.

When adding a capability:

1. check whether an existing canonical permission already describes it;
2. identify the server owner that must enforce it;
3. update canonical RBAC only when the product capability genuinely requires a new permission;
4. update UI visibility only after server enforcement exists;
5. update this reference and matching tests in the same change.

### Local session versus service-administrator authorization

The explicit service-administrator token boundary (`ADMIN_TOKEN` / `x-admin-token`) is **not** a portal role and must not be represented as an `admin` permission set. It is a purpose-specific server authorization path for narrowly supported administrative/recovery endpoints.

A valid service-administrator token does not imply that all browser/session routes are available and does not remove schema, maintenance, recovery or route-specific safety gates.

See [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md) for the trust-boundary overview.

### Approval is an additional gate

Approval policy is not a role. `xyops.approve` grants the capability to approve/reject when the current approval contract allows it; a dangerous XYOps process can still require an approval workflow even when the requester has `xyops.run`.

Requester/approver separation, expiry and process-policy rules belong to the approval-policy owner and are not encoded by the role name alone.

## Capability ownership map

| Capability | Permission(s) normally involved | Exact owner to inspect before changing behavior |
| --- | --- | --- |
| Read users/groups/catalog/operations | `directory.read` | current FreeIPA/XYOps/read handlers and their tests |
| Create/edit FreeIPA objects | `freeipa.write` | FreeIPA Worker/Gateway handlers and tests |
| Delete FreeIPA objects | `freeipa.delete` | destructive FreeIPA handlers and tests |
| Launch/stop/replay XYOps | `xyops.run` | XYOps execution ownership modules and `XYOPS_EXECUTION_OWNERSHIP.md` |
| Approve/reject dangerous XYOps work | `xyops.approve` | approval policy/request/decision owners and tests |
| Portal settings/admin/audit/diagnostics | `settings.manage` | relevant settings/admin/session/audit/diagnostic handlers and tests |
| Sanitized backup | `backup.export` | backup export owner/tests |
| Full encrypted backup | `backup.export.encrypted` | encrypted backup owner/tests |
| Backup restore preview | `backup.restore.preview` | backup import/encrypted preview route roots and tests |
| Isolated restore | `backup.restore.test` | isolated restore owner/tests |
| Selective restore stage | `backup.restore.prepare` | selective restore preflight/stage owner/tests |
| Selective restore commit | `backup.restore.commit` | selective restore commit owner/tests |
| Selective restore cancel | `backup.restore.cancel` | selective restore cancellation owner/tests |
| Maintenance/recovery control | `maintenance.manage` | maintenance/recovery handlers and active runbooks |

This table is an orientation map, not a substitute for route-level tests.

## RBAC ownership consolidation

Issue **#119 — consolidate duplicate and orphan portal RBAC owners** established the consolidation rule used by the current implementation:

- `portal-permissions.ts` is the only runtime owner of portal role names, canonical permission vocabulary and built-in role-to-permission mappings;
- `backup.restore.preview` is intentionally a distinct canonical capability because read-only restore preview is different from isolated test restore; it remains built-in `admin` only;
- route roots consume canonical role/permission helpers instead of maintaining private permission maps;
- identity/session adapters such as local-session and service-administrator wrappers may adapt identity or establish a purpose-specific trust boundary, but they must not create a second portal permission vocabulary;
- `ADMIN_TOKEN`, recovery credentials and other service authorization mechanisms remain separate from portal RBAC.

If a route requires a permission that is absent from `portal-permissions.ts`, treat that as RBAC drift and resolve it deliberately rather than introducing a route-local permission string.

## Change checklist

A permission/RBAC change is incomplete until all applicable items are addressed:

- canonical role/permission owner updated;
- server-side enforcement updated;
- route/domain tests updated;
- UI visibility updated only as a consumer of server capability;
- approval/service-admin boundaries reviewed separately;
- this document updated;
- `SECURITY_MODEL.md` updated if a trust boundary changed;
- no new duplicate permission registry introduced.

## Related references

- [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md) — identities and trust boundaries.
- [`../LOCAL_AUTH_RBAC.md`](../LOCAL_AUTH_RBAC.md) — local authentication/session behavior.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — current request architecture.
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) — canonical owner registry.

If this reference and current runtime disagree, verify `portal-permissions.ts`, the exact server handler and its tests first, then treat the mismatch as documentation/RBAC drift rather than inventing a third interpretation.