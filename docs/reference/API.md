# API reference

## Purpose

This document is the normalized **current-state HTTP API reference** for Admin Dashboard Softrust. It helps a developer or AI agent answer “does this capability already have a route, and who owns it?” before adding a new endpoint.

It does **not** replace runtime routing. Current routing is distributed across the Worker wrapper chain and route-specific modules; a single machine-readable route registry is tracked by **#121**. When this document and current code disagree, verify the exact handler and its tests first.

## Authorization legend

| Boundary | Meaning |
| --- | --- |
| Public | Does not require a portal session; response is intentionally bounded/redacted. |
| Local session | In production local mode, requires a valid portal session. Exact permission/role is enforced server-side. |
| Admin local session | Requires an administrator session; administrative mutations also pass the current same-origin guard. |
| Service admin | Purpose-specific `ADMIN_TOKEN` / `x-admin-token` boundary. This is not a browser role and is not a universal bypass. |
| Admin or service-admin delegated | Current local-secure boundary may delegate a validated admin session to an internal admin-token path, or allow the explicit service-admin path where supported. |

See [`PERMISSIONS.md`](PERMISSIONS.md) and [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md).

## Public health and monitoring

| Method | Path | Purpose | Boundary | Owner |
| --- | --- | --- | --- | --- |
| `GET` | `/health/live` | Process liveness. Docker restart signal. | Public | `worker/health-contracts.ts` |
| `GET` | `/health/ready` | Local readiness: database, schema, encryption and private FreeIPA Gateway. | Public | `worker/health-contracts.ts` |
| `GET` | `/health/dependencies` | Read-only FreeIPA/XYOps dependency health projection. | Public bounded diagnostics | `worker/dependency-health.ts` |
| `GET` | `/metrics/health` | Low-cardinality Prometheus projection of health state. | Public monitoring surface | `worker/health-metrics.ts` |
| `GET` | `/api/integrations/health` | Deprecated compatibility liveness endpoint; successor is `/health/live`. | Public | `worker/health-contracts.ts` |

Do not use dependency health as a process restart signal. Exact semantics live in `HEALTH_CONTRACTS.md` and `HEALTH_METRICS.md`.

## Local authentication and access administration

These routes are owned by `worker/local-secure-entry.ts` unless another owner is listed.

| Method | Path | Purpose | Boundary |
| --- | --- | --- | --- |
| `GET` | `/api/auth/session` | Resolve current local session/auth state. | Public login/session bootstrap surface; returns `401` when unauthenticated in local mode |
| `POST` | `/api/auth/login` | Authenticate local portal user and set session cookie. | Public credential submission; local mode only |
| `POST` | `/api/auth/logout` | Revoke current local session and clear cookie. | Local session |
| `GET` | `/api/auth/users` | List local portal users. | Admin local session |
| `POST` | `/api/auth/users` | Create local portal user. | Admin local session |
| `PUT` | `/api/auth/users/:userId` | Update display name/role/disabled state with self-demotion/disable protection. | Admin local session |
| `DELETE` | `/api/auth/users/:userId` | Delete local portal user with self-delete protection. | Admin local session |
| `POST` | `/api/auth/users/:userId/password` | Reset user password and revoke sessions. | Admin local session |
| `DELETE` | `/api/auth/users/:userId/sessions` | Revoke all sessions for a user. | Admin local session |
| `GET` | `/api/auth/sessions` | List local sessions and identify current session. | Admin local session; owner `worker/session-management-entry.ts` |
| `DELETE` | `/api/auth/sessions/:sessionId` | Revoke another local session; current session must use logout. | Admin local session; owner `worker/session-management-entry.ts` |
| `GET` | `/api/auth/diagnostics` | Sanitized local admin diagnostics including schema/configured-state summaries. | Admin local session; owner `worker/diagnostics-entry.ts` |

HTML access pages (`/login`, `/access`, `/sessions`, `/diagnostics`) have their own navigation/redirect rules and are not separate JSON capability owners.

## Integration status, settings and audit

The base integration handler is currently in `worker/index.ts`, wrapped by the settings/auth modules.

| Method | Path | Purpose | Boundary / capability |
| --- | --- | --- | --- |
| `GET` | `/api/integrations/status` | Effective portal/integration status plus effective role/permission projection. | Local session in production local mode; `directory.read`-oriented status consumer |
| `GET` | `/api/integrations/audit` | Query bounded portal audit events. | `settings.manage` |
| `GET` | `/api/integrations/settings` | Read public/redacted active integration settings. | `settings.manage` + administrator authorization |
| `PUT` | `/api/integrations/settings` | Legacy/direct settings write path. | `settings.manage` + administrator authorization; current lifecycle/draft path should be preferred where applicable |
| `POST` | `/api/integrations/settings/test` | Test FreeIPA or XYOps draft/current integration settings. | `settings.manage` + administrator authorization |
| `GET` | `/api/integrations/settings/effective` | Read effective settings plus source metadata. | Admin context; owner `worker/settings-lifecycle-entry.ts` |
| `POST` | `/api/integrations/settings/drafts` | Create revision-aware settings draft. | Admin context; owner `worker/settings-lifecycle-entry.ts` |
| `GET` | `/api/integrations/settings/drafts/:draftId` | Read one settings draft without exposing raw secrets. | Admin context |
| `POST` | `/api/integrations/settings/drafts/:draftId/validate` | Validate a draft and configured integration transitions. | Admin context |
| `POST` | `/api/integrations/settings/drafts/:draftId/apply` | Apply a validated draft through revision/CAS lifecycle. | Admin context |
| `POST` | `/api/integrations/settings/drafts/:draftId/cancel` | Cancel mutable draft and clear staged secrets. | Admin context |
| `GET` | `/api/integrations/settings/revisions` | List bounded settings revision history. | Admin context; owner `worker/settings-revisions-entry.ts` |
| `GET` | `/api/integrations/settings/revisions/:revision` | Read one public/redacted settings revision. | Admin context |

Secrets are never returned by these references. See [`CONFIGURATION.md`](CONFIGURATION.md).

## FreeIPA directory API

| Method | Path | Purpose | Boundary / permission | Owner |
| --- | --- | --- | --- | --- |
| `GET` | `/api/integrations/users` | List FreeIPA users; optional query/pagination layer recognizes `q,status,group,sort,direction,page,pageSize`. | `directory.read` through current integration/session boundary | `worker/index.ts` + `worker/freeipa-user-query-entry.ts` |
| `GET` | `/api/integrations/users/export.csv` | CSV export of the currently filtered FreeIPA user set with spreadsheet-formula escaping. | Read capability; live FreeIPA required | `worker/freeipa-user-bulk-entry.ts` |
| `GET` | `/api/integrations/groups` | List FreeIPA groups. | `directory.read` | `worker/index.ts` |
| `GET` | `/api/integrations/groups/members?group=...` | Resolve/query members of one FreeIPA group. | Read capability | `worker/freeipa-group-member-entry.ts` |
| `POST` | `/api/integrations/freeipa/actions` | Single supported FreeIPA mutation selected by operation. | `freeipa.write`; `freeipa.delete` for `user_del`/`group_del` | `worker/index.ts` |
| `POST` | `/api/integrations/freeipa/bulk` | Bounded bulk `enable`, `disable` or `add_to_group` (max 50, concurrency 3). | `freeipa.write` | `worker/freeipa-user-bulk-entry.ts` |

FreeIPA credentials/session cookies remain server-side behind the private Gateway. Do not create browser-side FreeIPA clients.

## XYOps catalog and portal routing

`/api/integrations/routes` describes **portal automation routing profiles**, not the portal HTTP API registry.

| Method | Path | Purpose | Boundary / permission |
| --- | --- | --- | --- |
| `GET` | `/api/integrations/catalog` | Load normalized/visibility-filtered XYOps catalog. | Local session / catalog visibility policy |
| `GET` | `/api/integrations/catalog/history` | Read stored catalog synchronization history. | Local session |
| `GET` | `/api/integrations/catalog/options` | Resolve dynamic option values from an allowed catalog field provider. | Local session; event/policy validated |
| `POST` | `/api/integrations/catalog/run` | Launch allowed Event/Workflow or create approval requirement according to policy. | `xyops.run` plus catalog/approval gates |
| `GET` | `/api/integrations/routes` | Read portal automation routing profiles. | `settings.manage` |
| `PUT` | `/api/integrations/routes` | Persist routing profiles. | `settings.manage` + administrator authorization + encrypted persistence |
| `GET` | `/api/integrations/catalog/presentation` | Read process presentation metadata. | `settings.manage` + administrator authorization |
| `PUT` | `/api/integrations/catalog/presentation` | Persist process presentation metadata. | `settings.manage` + administrator authorization |
| `GET` | `/api/integrations/catalog/policies` | Read catalog visibility policy set. | `settings.manage` + administrator authorization |
| `PUT` | `/api/integrations/catalog/policies` | Persist catalog visibility policy set. | `settings.manage` + administrator authorization |
| `GET` | `/api/integrations/approval/policies` | Read approval policy set. | `settings.manage` + administrator authorization |
| `PUT` | `/api/integrations/approval/policies` | Persist approval policy set. | `settings.manage` + administrator authorization |

For execution ownership and why the portal is not a second scheduler, see `XYOPS_EXECUTION_OWNERSHIP.md`.

## Approvals, runs, notifications and result files

| Method | Path | Purpose | Boundary / permission |
| --- | --- | --- | --- |
| `GET` | `/api/integrations/approvals` | List approvals visible to the current portal user. | `directory.read` |
| `POST` | `/api/integrations/approvals/:approvalId/approve` | Approve a pending request. | `xyops.approve` + approval-policy rules |
| `POST` | `/api/integrations/approvals/:approvalId/reject` | Reject a pending request. | `xyops.approve` |
| `POST` | `/api/integrations/approvals/:approvalId/cancel` | Cancel request where current approval rules allow it. | `xyops.run` |
| `POST` | `/api/integrations/approvals/:approvalId/execute` | Execute a sufficiently approved request after rechecking schema/catalog/policy. | `xyops.run` + approval gate |
| `GET` | `/api/integrations/runs` | List/synchronize normalized operation runs and summary counts. | Local session/read capability |
| `POST` | `/api/integrations/runs/:runId/cancel` | Stop an active supported XYOps job. | `xyops.run` |
| `POST` | `/api/integrations/runs/:runId/rerun` | Safe replay of a terminal replayable run. | `xyops.run` + replay/catalog checks |
| `GET` | `/api/integrations/runs/:runId/files/:fileId` | Proxy an allowlisted result file from the same XYOps origin with size/redirect protections. | `directory.read` |
| `GET` | `/api/integrations/notifications` | List current user's run notifications. | `directory.read` |
| `POST` | `/api/integrations/notifications/read` | Mark selected/all run notifications as read. | `directory.read` |

## Backup and restore API

| Method | Path | Purpose | Boundary / permission | Owner |
| --- | --- | --- | --- | --- |
| route-owned | `/api/admin/backups/export` | Sanitized backup export. | `backup.export` | `worker/backup-export-entry.ts` via `worker/index.ts` |
| route-owned | `/api/admin/backups/import/preview` | Read-only sanitized backup import preview. | route-local legacy/orphan `backup.restore.preview`; admin | `worker/backup-import-preview-root-entry.ts` |
| route-owned | `/api/admin/backups/export/encrypted` | Full encrypted backup export. | `backup.export.encrypted`; admin | `worker/backup-encrypted-root-entry.ts` |
| route-owned | `/api/admin/backups/import/encrypted/preview` | Encrypted backup preview. | route-local legacy/orphan `backup.restore.preview`; admin | `worker/backup-encrypted-root-entry.ts` |
| route-owned | `/api/admin/backups/import/encrypted/test-restore` | Isolated test restore. | `backup.restore.test`; admin | `worker/backup-encrypted-root-entry.ts` |
| `POST` | `/api/admin/backups/import/encrypted/prepare-commit` | Preflight and stage selective production restore with recovery point. | `backup.restore.prepare`; admin + same-origin | `worker/backup-selective-restore-entry.ts` |
| `POST` | `/api/admin/backups/import/encrypted/commit` | Transactional selective restore commit. | `backup.restore.commit`; admin + same-origin + stage secret/confirmation | `worker/backup-selective-restore-entry.ts` |
| `POST` | `/api/admin/backups/import/encrypted/cancel` | Cancel uncommitted restore stage. | `backup.restore.cancel`; admin + same-origin | `worker/backup-selective-restore-entry.ts` |

`route-owned` means the exact method/body contract is owned and validated by the referenced handler; do not infer it from the route name. This reference deliberately avoids duplicating large backup payload schemas.

## Storage, schema and migration administration

| Method | Path | Purpose | Boundary | Owner |
| --- | --- | --- | --- | --- |
| `GET` | `/api/admin/storage/status` | Sanitized storage/schema/lifecycle status. | Admin role; explicit service-admin delegation supported by outer auth boundary | `storage-status-contract.ts`, `worker/storage-status-entry.ts` |
| `POST` | `/api/admin/storage/integrity/check` | Read-only SQLite/index integrity inspection. | Admin role; service-admin delegation supported | `storage-integrity-contract.ts`, `worker/storage-integrity-entry.ts` |
| `POST` | `/api/admin/storage/migrations/preflight` | Read-only migration readiness decision; body must be `{}` and ≤1 KiB. | Admin role; service-admin delegation supported | `storage-migration-preflight-contract.ts`, `worker/storage-migration-preflight-entry.ts` |
| `POST` | `/api/admin/storage/migrations/apply` | Controlled migration apply. | Guarded admin/maintenance controller workflow | `storage-migration-apply-contract.ts` + apply handler/tests |
| route-owned | `/api/admin/storage/migrations/apply/status` | Read bounded migration-operation status. | Guarded admin/service workflow | `storage-migration-apply-contract.ts` + apply handler/tests |
| route-owned | `/api/admin/storage/migrations/apply/reconcile` | Reconcile controlled migration operation evidence. | Guarded admin/maintenance workflow | `storage-migration-apply-contract.ts` + apply handler/tests |
| `GET` | `/api/schema/status` | Public-safe schema state for explicit service administrator. | Service admin token | `worker/schema-migrations-entry.ts` |

Apply/reconcile operations are not ordinary settings mutations. Follow `DATABASE_MIGRATIONS.md` and the storage runbooks.

## Maintenance API

The maintenance control family requires portal admin access through its current dispatch. Mutations are same-origin protected and use operation/controller/confirmation state; verification smoke additionally requires the service-admin-authorized marker.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/maintenance/status` | Read safe persistent maintenance state. |
| `POST` | `/api/admin/maintenance/prepare` | Prepare a maintenance operation. |
| `POST` | `/api/admin/maintenance/enter` | Enter maintenance. |
| `POST` | `/api/admin/maintenance/verification/start` | Start verification phase. |
| `POST` | `/api/admin/maintenance/exit` | Submit verification and transition toward exit. |
| `POST` | `/api/admin/maintenance/complete` | Complete verified maintenance. |
| `POST` | `/api/admin/maintenance/cancel` | Cancel an eligible prepared/entering maintenance operation. |

Additional verification-smoke route details belong to `MAINTENANCE_MODE.md` and `worker/maintenance-verification-smoke-entry.ts`; do not copy controller secrets or destructive operational commands into this overview.

## Request-wide gates

The exact wrapper depends on the path, but API changes must preserve these current concerns where applicable:

1. health/schema outer boundary;
2. identity/session or explicit service-admin resolution;
3. server-side RBAC/role check;
4. same-origin check for protected admin mutations;
5. maintenance/recovery state restrictions;
6. bounded body/path/query validation;
7. domain handler/integration client;
8. audit/evidence persistence where the contract defines it;
9. sanitized error/response projection.

Do not add a new route by bypassing an existing outer gate simply because the underlying domain function is reusable.

## Known route-registry limitation

There is currently no single declarative runtime registry containing every method/path/auth/permission contract. Routing is distributed between `worker/index.ts`, wrapper entry modules and route constants. Follow-up **#121** tracks a machine-readable route contract suitable for drift checks and future documentation generation.

Until #121 is resolved:

- use this file as a normalized orientation reference;
- verify the exact current handler and test before modifying a route;
- do not use `/api/integrations/routes` as an HTTP API registry;
- do not add a second endpoint when an existing capability can be extended;
- when a route changes, update its handler/tests and this reference in the same PR.

## Related references

- [`PERMISSIONS.md`](PERMISSIONS.md)
- [`CONFIGURATION.md`](CONFIGURATION.md)
- [`ERROR_CODES.md`](ERROR_CODES.md)
- [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md)
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md)
