# Error-code reference

## Purpose

This document describes **stable machine-readable codes that are already emitted or consumed as contracts** by Admin Dashboard Softrust.

`src/auth/stable-error-contract.ts` is the normalized machine-readable ownership and verification surface for the verified stable subset. Runtime/domain owners and their tests remain authoritative for emitted behavior and semantics; the registry does not replace domain handlers or typed domain contracts.

It intentionally does not promote arbitrary human-readable `error` strings, audit action names, exception messages, or transient identifiers into permanent API contracts.

## Reading this reference

- `code` is a machine-readable value intentionally suitable for programmatic branching, monitoring, diagnostics, or bounded operator handling.
- `src/auth/stable-error-contract.ts` records namespace/domain/owner and bounded metadata for the verified stable subset.
- HTTP status is listed only where the current owner fixes it as part of the contract.
- Audit `action` values such as `maintenance.enter` or `backup.selective.commit.failed` are **not** API error codes.
- Audit `errorCode` fields may carry domain codes as evidence, but the `audit-evidence` namespace remains distinct from API response codes.
- Human messages may change without changing the machine code unless the owning contract states otherwise.

## Health and readiness

Owner: `worker/health-contracts.ts`.

### Top-level health codes

| Code | Context | HTTP / semantics |
| --- | --- | --- |
| `health_live` | `/health/live` | `200`; process answers HTTP. |
| `health_ready` | `/health/ready` | `200`; required local readiness checks passed. |
| `health_database_unavailable` | readiness | `503`; migration-capable database unavailable. |
| `health_schema_unready` | readiness | `503`; schema cannot be established as ready. |
| `health_encryption_unavailable` | readiness | `503`; encryption self-test failed/unavailable. |
| `health_gateway_unavailable` | readiness | `503`; private FreeIPA Gateway readiness failed. |

### Readiness component codes

- `database_available`
- `database_unavailable`
- `schema_ready`
- `schema_unavailable`
- `schema_migration_pending`
- `schema_unready`
- `encryption_ready`
- `encryption_unavailable`
- `gateway_ready`
- `gateway_unavailable`

Metrics endpoint owner `worker/health-metrics.ts` additionally emits `health_metrics_method_not_allowed` with HTTP `405` for non-GET requests.

## Dependency health

Owner: `worker/dependency-health.ts`.

### Aggregate and precondition codes

| Code | HTTP / meaning |
| --- | --- |
| `dependencies_healthy` | `200`; all configured dependency probes are healthy. |
| `dependencies_degraded` | `200`; at least one dependency is degraded/unconfigured while the diagnostic itself completed. |
| `dependency_method_not_allowed` | `405`; `/health/dependencies` is GET-only. |
| `dependency_database_unavailable` | `503`; local database boundary unavailable. |
| `dependency_schema_unready` | `503`; canonical schema not ready. |
| `dependency_configuration_unavailable` | `503`; effective dependency configuration could not be loaded safely. |

### FreeIPA dependency codes

- `freeipa_ready`
- `freeipa_not_configured`
- `freeipa_dns_failed`
- `freeipa_tls_failed`
- `freeipa_timeout`
- `freeipa_auth_rejected`
- `freeipa_protocol_failed`
- `freeipa_unavailable`

### XYOps dependency codes

- `xyops_ready`
- `xyops_demo_mode`
- `xyops_not_configured`
- `xyops_auth_rejected`
- `xyops_rate_limited`
- `xyops_upstream_failed`
- `xyops_protocol_failed`
- `xyops_timeout`
- `xyops_unavailable`

Dependency probe codes are diagnostic classifications, not automatic restart instructions.

## Storage status

Owners: `storage-status.ts`, `worker/storage-status-entry.ts`.

### Route-level codes

- `storage_status_method_not_allowed` — HTTP `405`.
- `storage_status_forbidden` — HTTP `403`.
- `storage_status_unavailable` — HTTP `503` bounded fallback.

### Storage report codes

- `storage_domain_counted`
- `storage_domain_partial`
- `storage_size_available`
- `storage_size_unavailable`
- `storage_database_unavailable`
- `storage_inventory_unavailable`
- `storage_encryption_ready`
- `storage_encryption_unavailable`
- `storage_lifecycle_available`
- `storage_lifecycle_unavailable`

### Safe schema codes surfaced by storage status

- `schema_database_unavailable`
- `schema_busy`
- `schema_incompatible`
- `schema_migration_failed`
- `schema_journal_gap`
- `schema_incompatible_drift`
- `schema_missing`
- `schema_unavailable`
- fallback `schema_unready`

Exact schema state/error semantics remain owned by the canonical migration runtime and `operations/DATABASE_MIGRATIONS.md`.

## Storage integrity

Owners: `storage-integrity-contract.ts`, `worker/storage-integrity-entry.ts`.

### Route-level codes

- `storage_integrity_method_not_allowed` — HTTP `405`.
- `storage_integrity_forbidden` — HTTP `403`.
- `storage_integrity_unavailable` — bounded unavailable/failure evidence.

### Quick-check and index-inventory codes

- `storage_quick_check_ok`
- `storage_quick_check_failed`
- `storage_quick_check_unsupported`
- `storage_quick_check_unavailable`
- `storage_indexes_ready`
- `storage_indexes_degraded`
- `storage_indexes_unavailable`

These codes describe read-only inspection state; they do not authorize automatic repair.

## Storage migration preflight

Owners: `storage-migration-preflight-contract.ts`, `worker/storage-migration-preflight-entry.ts`.

| Code | HTTP / meaning |
| --- | --- |
| `migration_preflight_method_not_allowed` | `405`; preflight is POST-only. |
| `migration_preflight_forbidden` | `403`; effective role is not admin. |
| `migration_preflight_request_too_large` | `413`; body exceeds the current bound. |
| `migration_preflight_request_invalid` | `400`; invalid request shape/body. |
| `migration_preflight_unavailable` | `503`/audit evidence when inspection is unavailable. |

The aggregate preflight report may contain additional component codes produced by schema, journal, integrity, backup, and migration-lock owners. Those values are not automatically promoted into the stable registry merely because they are strings.

## Maintenance control

Owner: `worker/maintenance-control-entry.ts`.

| Code | HTTP | Operator meaning |
| --- | ---: | --- |
| `maintenance_request_invalid` | 400 | Request shape/body is invalid. |
| `maintenance_request_too_large` | 413 | Request exceeds bounded body size. |
| `maintenance_origin_forbidden` | 403 | Same-origin authorization failed. |
| `maintenance_method_not_allowed` | 405 | Wrong method for maintenance route. |
| `maintenance_state_unavailable` | 503 | Persistent maintenance state unavailable. |
| `maintenance_operation_conflict` | 409 | Requested operation conflicts with current state. |
| `maintenance_controller_invalid` | 409 | Controller secret/operation controller is invalid. |
| `maintenance_confirmation_required` | 422 | Required explicit confirmation absent/invalid. |
| `maintenance_prepare_expired` | 409 | Prepared maintenance operation expired. |
| `maintenance_transition_invalid` | 409 | State transition is not allowed. |
| `maintenance_verification_invalid` | 422 | Verification evidence invalid. |
| `maintenance_transition_failed` | 500 | Safe normalized fallback for unexpected failure. |

Do not branch automation on an English/Russian human message when the machine code is available.

## Selective backup restore

Owner: `worker/backup-selective-restore-entry.ts`.

| Code | HTTP | Meaning |
| --- | ---: | --- |
| `backup_route_not_found` | 404 | Unsupported selective-restore route. |
| `backup_origin_forbidden` | 403 | Same-origin administrator request required. |
| `backup_method_not_allowed` | 405 | Selective restore routes are POST-only. |
| `backup_request_too_large` | 413 | Request exceeds the path-specific body limit. |
| `backup_request_invalid` | 400 | Invalid JSON/request shape. |
| `backup_database_unavailable` | 503 | Required local database unavailable. |
| `backup_schema_incompatible` | 409 | Current/backup schema boundary incompatible. |
| `backup_restore_dependency_invalid` | 422 | Selected domains violate dependency rules. |
| `backup_restore_domain_unsupported` | 422 | Requested domain is unsupported. |
| `backup_restore_confirmation_required` | 422 | Explicit confirmation missing/invalid. |
| `backup_restore_admin_required` | 422 | Restored local-auth state would not preserve the required administrator. |
| `backup_restore_stage_invalid` | 409 | Restore stage/secret/state invalid. |
| `backup_restore_stage_expired` | 409 | Restore stage expired. |
| `backup_restore_stage_cancelled` | 409 | Restore stage already cancelled. |
| `backup_restore_stage_committed` | 409 | Restore stage already committed. |
| `backup_restore_stale` | 409 | Preview/stage is stale. |
| `backup_recovery_point_invalid` | 422 | Required recovery point is invalid. |
| `backup_recovery_point_stale` | 409 | Recovery point no longer satisfies freshness/state requirements. |
| `backup_restore_commit_failed` | 500 | Safe fallback for unexpected commit failure. |

Other backup/export/import handlers keep their own bounded contracts and must not be silently folded into this map without verification.

## Settings lifecycle and source control

Owners: `worker/settings-lifecycle-entry.ts`, `worker/settings-source-entry.ts`, `worker/settings-revisions-entry.ts`.

Verified stable machine codes include:

| Code | Typical HTTP | Meaning |
| --- | ---: | --- |
| `settings_revision_conflict` | 409 | Active revision changed relative to requested/draft base revision. |
| `settings_draft_not_validated` | 409 | Apply attempted before successful validation. |
| `settings_draft_busy` | 409 | Draft already claimed/being changed. |
| `settings_draft_inactive` | 409 | Draft can no longer be cancelled/mutated as requested. |
| `settings_rollback_conflict` | 409 | Automatic rollback stopped because active configuration changed concurrently. |
| `settings_source_busy` | 409 | Another operation owns the settings-source mutation lock. |

This remains a **verified subset**, not a claim that every settings response is globally enumerated. Stable values that are intentionally part of the composed machine contract belong in `src/auth/stable-error-contract.ts`; other domain-local/transient strings remain with their domain owner.

## Codes intentionally excluded

Do not add these categories unless they become explicit machine contracts:

- arbitrary `error: "..."` human text;
- JavaScript exception messages;
- FreeIPA/XYOps raw upstream messages;
- audit action names such as `rbac.user.created`, `xyops.run.cancel`, `settings.draft.applied`;
- audit outcome values (`success`, `failure`, `unknown`);
- transient correlation IDs, run IDs, stage IDs, or job IDs;
- HTTP status alone when no stable code exists.

## Ownership and drift rules

Stable codes may still be **implemented** in typed unions, fixed maps, or handler-local constants owned by their domains. `src/auth/stable-error-contract.ts` composes the intentionally stable subset so tooling can verify namespace/domain ownership without centralizing runtime behavior.

When changing a stable code:

1. verify and change the exact domain owner/test first;
2. update `src/auth/stable-error-contract.ts` when the value is intentionally in the stable machine contract;
3. never reuse an existing `namespace + code` for a different semantic condition or conflicting owner;
4. keep `api`, `status`, and `audit-evidence` namespaces distinct;
5. update this reference when public/operator-facing semantics change;
6. do not rename/remove an emitted stable code without explicit compatibility analysis and migration tests;
7. never treat human messages or audit action names as error-code aliases.

`tests/stable-error-contract.test.mjs` verifies registry uniqueness/conflicts, namespace-aware lookup, excluded categories, and synchronization of registered values with this reference.

## Related references

- [`../ERROR_CODE_OWNERSHIP.md`](../ERROR_CODE_OWNERSHIP.md)
- [`API.md`](API.md)
- [`PERMISSIONS.md`](PERMISSIONS.md)
- [`CONFIGURATION.md`](CONFIGURATION.md)
- [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md)
- [`../HEALTH_CONTRACTS.md`](../HEALTH_CONTRACTS.md)
- [`../DATABASE_MIGRATIONS.md`](../DATABASE_MIGRATIONS.md)
- [`../MAINTENANCE_MODE.md`](../MAINTENANCE_MODE.md)

If a code documented here is no longer emitted by its current owner, treat that as documentation drift and correct the reference; do not reintroduce dead runtime behavior merely to satisfy this file.