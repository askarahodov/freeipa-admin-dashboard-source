# Error-code reference

## Purpose

This document normalizes **stable machine-readable codes that are already emitted or consumed as contracts** by Admin Dashboard Softrust.

It does not promote arbitrary human-readable `error` strings, audit action names or one-off internal exception messages into permanent API contracts. Runtime/domain owners and their tests remain authoritative. A single global error-code registry does not exist yet; ownership normalization is tracked by **#124**.

## Reading this reference

- `code` means a machine-readable field intentionally suitable for programmatic branching, monitoring, diagnostics or bounded operator handling.
- HTTP status is listed only where the current owner fixes it as part of the contract.
- Audit `action` values such as `maintenance.enter` or `backup.selective.commit.failed` are **not** API error codes.
- Audit `errorCode` fields can carry domain codes as evidence, but the audit namespace itself does not create a new HTTP contract.
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

| Code | Meaning |
| --- | --- |
| `database_available` | Local database check is ready. |
| `database_unavailable` | Local database check is unready. |
| `schema_ready` | Canonical schema is ready. |
| `schema_unavailable` | Schema inspection failed/unavailable. |
| `schema_migration_pending` | Schema has a pending migration state exposed by the schema contract. |
| `schema_unready` | Schema is not ready for another bounded reason. |
| `encryption_ready` | AES-GCM encryption self-test passed. |
| `encryption_unavailable` | Encryption self-test unavailable/failed. |
| `gateway_ready` | Private FreeIPA Gateway readiness passed. |
| `gateway_unavailable` | Private Gateway readiness failed. |

Metrics endpoint owner `worker/health-metrics.ts` additionally emits `health_metrics_method_not_allowed` with HTTP `405` for non-GET requests.

## Dependency health

Owner: `worker/dependency-health.ts`.

### Aggregate and precondition codes

| Code | HTTP / meaning |
| --- | --- |
| `dependencies_healthy` | `200`; all configured dependency probes are healthy. |
| `dependencies_degraded` | `200`; at least one dependency is degraded/unconfigured while the dependency diagnostic itself completed. |
| `dependency_method_not_allowed` | `405`; `/health/dependencies` is GET-only. |
| `dependency_database_unavailable` | `503`; local database boundary unavailable. |
| `dependency_schema_unready` | `503`; canonical schema not ready. |
| `dependency_configuration_unavailable` | `503`; effective dependency configuration could not be loaded safely. |

### FreeIPA dependency codes

| Code | Category / meaning |
| --- | --- |
| `freeipa_ready` | `ok`; probe succeeded. |
| `freeipa_not_configured` | `configuration`; required FreeIPA/Gateway configuration absent. |
| `freeipa_dns_failed` | `dns`; Gateway classified DNS failure. |
| `freeipa_tls_failed` | `tls`; TLS verification/handshake failure. |
| `freeipa_timeout` | `timeout`; probe timed out. |
| `freeipa_auth_rejected` | `authentication`; upstream credentials rejected. |
| `freeipa_protocol_failed` | `protocol`; response/protocol contract invalid or unknown Gateway code normalized to protocol failure. |
| `freeipa_unavailable` | `network`; dependency unavailable/network failure. |

### XYOps dependency codes

| Code | Category / meaning |
| --- | --- |
| `xyops_ready` | `ok`; catalog probe succeeded. |
| `xyops_demo_mode` | `disabled`; demo mode intentionally avoids a live XYOps dependency when unconfigured. |
| `xyops_not_configured` | `configuration`; URL/API key unavailable. |
| `xyops_auth_rejected` | `authentication`; HTTP 401/403 from XYOps. |
| `xyops_rate_limited` | `rate_limited`; HTTP 429. |
| `xyops_upstream_failed` | `upstream`; HTTP 5xx. |
| `xyops_protocol_failed` | `protocol`; unexpected non-success response/application payload. |
| `xyops_timeout` | `timeout`; probe timed out. |
| `xyops_unavailable` | `network`; network/unavailable failure. |

Dependency probe codes are diagnostic classifications, not automatic restart instructions.

## Storage status

Owners: `storage-status.ts`, `worker/storage-status-entry.ts`.

### Route-level codes

| Code | HTTP / meaning |
| --- | --- |
| `storage_status_method_not_allowed` | `405`; status route is GET-only. |
| `storage_status_forbidden` | `403`; effective access is not admin. |
| `storage_status_unavailable` | `503`; fixed bounded fallback when storage inspection cannot produce a usable report. |

### Storage report codes

| Code | Meaning |
| --- | --- |
| `storage_domain_counted` | Domain's expected tables were counted successfully. |
| `storage_domain_partial` | Domain inventory is incomplete/degraded. |
| `storage_size_available` | page count/page size produced a bounded logical size. |
| `storage_size_unavailable` | database exists but size projection is unavailable. |
| `storage_database_unavailable` | database itself unavailable. |
| `storage_inventory_unavailable` | canonical inventory inspection unavailable. |
| `storage_encryption_ready` | storage encryption self-test ready. |
| `storage_encryption_unavailable` | encryption self-test unavailable. |
| `storage_lifecycle_available` | bounded backup/restore lifecycle evidence available. |
| `storage_lifecycle_unavailable` | lifecycle evidence unavailable. |

### Safe schema codes surfaced by storage status

The storage report only forwards an allowlisted/bounded schema code. Current safe values include:

- `schema_database_unavailable`
- `schema_busy`
- `schema_incompatible`
- `schema_migration_failed`
- `schema_journal_gap`
- `schema_incompatible_drift`
- `schema_missing`
- `schema_unavailable`
- fallback `schema_unready`

Exact schema state/error semantics remain owned by the canonical migration runtime and `DATABASE_MIGRATIONS.md`.

## Storage integrity

Owners: `storage-integrity-contract.ts`, `worker/storage-integrity-entry.ts`.

### Route-level codes

| Code | HTTP / meaning |
| --- | --- |
| `storage_integrity_method_not_allowed` | `405`; integrity route is POST-only. |
| `storage_integrity_forbidden` | `403`; effective role is not admin. |
| `storage_integrity_unavailable` | bounded unavailable/failure evidence used by the integrity/audit contract. |

### Quick-check codes

- `storage_quick_check_ok`
- `storage_quick_check_failed`
- `storage_quick_check_unsupported`
- `storage_quick_check_unavailable`

### Index-inventory codes

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
| `migration_preflight_request_too_large` | `413`; body exceeds the current 1 KiB bound. |
| `migration_preflight_request_invalid` | `400`; body is not the required plain empty JSON object. |
| `migration_preflight_unavailable` | `503`/audit evidence when preflight inspection is unavailable. |

The preflight report also contains component codes for schema, journal, integrity, backup and migration lock state. Those component values are produced by domain owners and are currently typed as strings in the aggregate contract; this reference does **not** invent an exhaustive global list for them. Ownership normalization is part of #124.

## Maintenance control

Owner: `worker/maintenance-control-entry.ts`.

The handler uses a fixed safe code → HTTP/status-message map:

| Code | HTTP | Operator meaning |
| --- | ---: | --- |
| `maintenance_request_invalid` | 400 | Request shape/body is invalid. |
| `maintenance_request_too_large` | 413 | Request exceeds bounded body size. |
| `maintenance_origin_forbidden` | 403 | Mutation failed same-origin authorization. |
| `maintenance_method_not_allowed` | 405 | Wrong method for maintenance route. |
| `maintenance_state_unavailable` | 503 | Persistent maintenance state unavailable. |
| `maintenance_operation_conflict` | 409 | Requested operation conflicts with current state. |
| `maintenance_controller_invalid` | 409 | Controller secret/operation controller is invalid. |
| `maintenance_confirmation_required` | 422 | Required explicit confirmation absent/invalid. |
| `maintenance_prepare_expired` | 409 | Prepared maintenance operation expired. |
| `maintenance_transition_invalid` | 409 | State transition is not allowed from current state. |
| `maintenance_verification_invalid` | 422 | Verification payload/evidence invalid. |
| `maintenance_transition_failed` | 500 | Safe normalized fallback for unexpected transition failure. |

Do not branch automation on the English/Russian human message when the code is available.

## Selective backup restore

Owner: `worker/backup-selective-restore-entry.ts`.

| Code | HTTP | Meaning |
| --- | ---: | --- |
| `backup_route_not_found` | 404 | Request reached the selective-restore handler for an unsupported route. |
| `backup_origin_forbidden` | 403 | Same-origin administrator request required. |
| `backup_method_not_allowed` | 405 | Selective restore routes are POST-only. |
| `backup_request_too_large` | 413 | Restore request exceeds the path-specific body limit. |
| `backup_request_invalid` | 400 | Invalid JSON/request shape. |
| `backup_database_unavailable` | 503 | Required local database unavailable. |
| `backup_schema_incompatible` | 409 | Current/backup schema boundary incompatible for the operation. |
| `backup_restore_dependency_invalid` | 422 | Selected restore domains violate dependency rules. |
| `backup_restore_domain_unsupported` | 422 | Requested domain is unsupported. |
| `backup_restore_confirmation_required` | 422 | Explicit restore confirmation missing/invalid. |
| `backup_restore_admin_required` | 422 | Restored local-auth state would not preserve a required active administrator. |
| `backup_restore_stage_invalid` | 409 | Restore stage/secret/state invalid. |
| `backup_restore_stage_expired` | 409 | Restore stage expired. |
| `backup_restore_stage_cancelled` | 409 | Restore stage was already cancelled. |
| `backup_restore_stage_committed` | 409 | Restore stage was already committed. |
| `backup_restore_stale` | 409 | Preview/stage is stale relative to current state. |
| `backup_recovery_point_invalid` | 422 | Required recovery point is invalid. |
| `backup_recovery_point_stale` | 409 | Recovery point no longer satisfies freshness/state requirements. |
| `backup_restore_commit_failed` | 500 | Safe fallback for unexpected commit failure. |

These are selective production restore codes. Other backup/export/import handlers have their own bounded contracts and must not be silently folded into this map without verification.

## Settings lifecycle and source control

Owners: `worker/settings-lifecycle-entry.ts`, `worker/settings-source-entry.ts`, `worker/settings-revisions-entry.ts`.

Verified stable machine codes currently include:

| Code | Typical HTTP | Meaning |
| --- | ---: | --- |
| `settings_revision_conflict` | 409 | Active revision changed relative to requested/draft base revision. |
| `settings_draft_not_validated` | 409 | Apply attempted before successful validation. |
| `settings_draft_busy` | 409 | Draft already claimed/being changed. |
| `settings_draft_inactive` | 409 | Draft can no longer be cancelled/mutated in requested way. |
| `settings_rollback_conflict` | 409 | Automatic rollback stopped because active configuration changed concurrently. |
| `settings_source_busy` | 409 | Another operation currently owns the settings-source mutation lock. |

This is intentionally a **verified subset**, not a claim that every settings response has been globally enumerated. #124 owns normalization of distributed stable error-code ownership.

## Codes intentionally excluded

Do not add these categories to this reference unless they become explicit machine contracts:

- arbitrary `error: "..."` human text;
- JavaScript exception messages;
- FreeIPA/XYOps raw upstream messages;
- audit action names such as `rbac.user.created`, `xyops.run.cancel`, `settings.draft.applied`;
- audit outcome values (`success`, `failure`, `unknown`);
- transient correlation IDs, run IDs, stage IDs or job IDs;
- HTTP status alone when no stable code exists.

## Drift and ownership limitation

Stable codes currently live in several typed unions, fixed maps and handler-local constants. There is no single global machine-readable registry. Follow-up **#124** tracks normalization while preserving domain ownership and current semantics.

Until then:

1. check this reference for known contract codes;
2. verify the exact domain owner/test before adding or changing a code;
3. prefer extending an existing domain namespace over inventing a parallel spelling;
4. never reuse an existing code for a different semantic condition;
5. update this reference when a stable public/operator-facing code changes;
6. do not treat audit action names as error-code aliases.

## Related references

- [`API.md`](API.md)
- [`PERMISSIONS.md`](PERMISSIONS.md)
- [`CONFIGURATION.md`](CONFIGURATION.md)
- [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md)
- [`../HEALTH_CONTRACTS.md`](../HEALTH_CONTRACTS.md)
- [`../DATABASE_MIGRATIONS.md`](../DATABASE_MIGRATIONS.md)
- [`../MAINTENANCE_MODE.md`](../MAINTENANCE_MODE.md)

If a code documented here is no longer emitted by its current owner, treat that as documentation drift and correct the reference; do not reintroduce dead runtime behavior merely to satisfy this file.