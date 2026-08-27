export type StableErrorNamespace = "api" | "status" | "audit-evidence";

export type StableErrorContract = {
  code: string;
  domain: string;
  namespace: StableErrorNamespace;
  owner: string;
  httpStatus?: number;
  retryable?: boolean;
  operatorAction?: "none" | "retry" | "inspect" | "reconfigure" | "manual-recovery";
};

/**
 * Canonical machine-readable ownership registry for stable codes already
 * documented and verified as contracts. This registry intentionally does not
 * promote arbitrary human error strings, exception messages, audit action
 * names, or transient identifiers into public contracts.
 */
export const stableErrorContracts = [
  { code: "health_live", domain: "health", namespace: "status", owner: "worker/health-contracts.ts", httpStatus: 200, retryable: false, operatorAction: "none" },
  { code: "health_ready", domain: "health", namespace: "status", owner: "worker/health-contracts.ts", httpStatus: 200, retryable: false, operatorAction: "none" },
  { code: "health_database_unavailable", domain: "health", namespace: "status", owner: "worker/health-contracts.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "health_schema_unready", domain: "health", namespace: "status", owner: "worker/health-contracts.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "health_encryption_unavailable", domain: "health", namespace: "status", owner: "worker/health-contracts.ts", httpStatus: 503, retryable: false, operatorAction: "reconfigure" },
  { code: "health_gateway_unavailable", domain: "health", namespace: "status", owner: "worker/health-contracts.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "health_metrics_method_not_allowed", domain: "health", namespace: "api", owner: "worker/health-metrics.ts", httpStatus: 405, retryable: false, operatorAction: "none" },

  { code: "dependencies_healthy", domain: "dependency-health", namespace: "status", owner: "worker/dependency-health.ts", httpStatus: 200, retryable: false, operatorAction: "none" },
  { code: "dependencies_degraded", domain: "dependency-health", namespace: "status", owner: "worker/dependency-health.ts", httpStatus: 200, retryable: true, operatorAction: "inspect" },
  { code: "dependency_method_not_allowed", domain: "dependency-health", namespace: "api", owner: "worker/dependency-health.ts", httpStatus: 405, retryable: false, operatorAction: "none" },
  { code: "dependency_database_unavailable", domain: "dependency-health", namespace: "api", owner: "worker/dependency-health.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "dependency_schema_unready", domain: "dependency-health", namespace: "api", owner: "worker/dependency-health.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "dependency_configuration_unavailable", domain: "dependency-health", namespace: "api", owner: "worker/dependency-health.ts", httpStatus: 503, retryable: false, operatorAction: "reconfigure" },

  { code: "freeipa_ready", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "none" },
  { code: "freeipa_not_configured", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "reconfigure" },
  { code: "freeipa_dns_failed", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: true, operatorAction: "inspect" },
  { code: "freeipa_tls_failed", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "inspect" },
  { code: "freeipa_timeout", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: true, operatorAction: "retry" },
  { code: "freeipa_auth_rejected", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "reconfigure" },
  { code: "freeipa_protocol_failed", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "inspect" },
  { code: "freeipa_unavailable", domain: "freeipa", namespace: "status", owner: "worker/dependency-health.ts", retryable: true, operatorAction: "retry" },

  { code: "xyops_ready", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "none" },
  { code: "xyops_demo_mode", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "none" },
  { code: "xyops_not_configured", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "reconfigure" },
  { code: "xyops_auth_rejected", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "reconfigure" },
  { code: "xyops_rate_limited", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: true, operatorAction: "retry" },
  { code: "xyops_upstream_failed", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: true, operatorAction: "retry" },
  { code: "xyops_protocol_failed", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: false, operatorAction: "inspect" },
  { code: "xyops_timeout", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: true, operatorAction: "retry" },
  { code: "xyops_unavailable", domain: "xyops", namespace: "status", owner: "worker/dependency-health.ts", retryable: true, operatorAction: "retry" },

  { code: "storage_status_method_not_allowed", domain: "storage-status", namespace: "api", owner: "worker/storage-status-entry.ts", httpStatus: 405, retryable: false, operatorAction: "none" },
  { code: "storage_status_forbidden", domain: "storage-status", namespace: "api", owner: "worker/storage-status-entry.ts", httpStatus: 403, retryable: false, operatorAction: "none" },
  { code: "storage_status_unavailable", domain: "storage-status", namespace: "api", owner: "worker/storage-status-entry.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "storage_integrity_method_not_allowed", domain: "storage-integrity", namespace: "api", owner: "worker/storage-integrity-entry.ts", httpStatus: 405, retryable: false, operatorAction: "none" },
  { code: "storage_integrity_forbidden", domain: "storage-integrity", namespace: "api", owner: "worker/storage-integrity-entry.ts", httpStatus: 403, retryable: false, operatorAction: "none" },
  { code: "storage_integrity_unavailable", domain: "storage-integrity", namespace: "status", owner: "storage-integrity-contract.ts", retryable: true, operatorAction: "inspect" },

  { code: "migration_preflight_method_not_allowed", domain: "migration-preflight", namespace: "api", owner: "worker/storage-migration-preflight-entry.ts", httpStatus: 405, retryable: false, operatorAction: "none" },
  { code: "migration_preflight_forbidden", domain: "migration-preflight", namespace: "api", owner: "worker/storage-migration-preflight-entry.ts", httpStatus: 403, retryable: false, operatorAction: "none" },
  { code: "migration_preflight_request_too_large", domain: "migration-preflight", namespace: "api", owner: "worker/storage-migration-preflight-entry.ts", httpStatus: 413, retryable: false, operatorAction: "none" },
  { code: "migration_preflight_request_invalid", domain: "migration-preflight", namespace: "api", owner: "worker/storage-migration-preflight-entry.ts", httpStatus: 400, retryable: false, operatorAction: "none" },
  { code: "migration_preflight_unavailable", domain: "migration-preflight", namespace: "api", owner: "storage-migration-preflight-contract.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },

  { code: "maintenance_request_invalid", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 400, retryable: false, operatorAction: "none" },
  { code: "maintenance_request_too_large", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 413, retryable: false, operatorAction: "none" },
  { code: "maintenance_origin_forbidden", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 403, retryable: false, operatorAction: "none" },
  { code: "maintenance_method_not_allowed", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 405, retryable: false, operatorAction: "none" },
  { code: "maintenance_state_unavailable", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "maintenance_operation_conflict", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 409, retryable: false, operatorAction: "inspect" },
  { code: "maintenance_controller_invalid", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "maintenance_confirmation_required", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 422, retryable: false, operatorAction: "manual-recovery" },
  { code: "maintenance_prepare_expired", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "maintenance_transition_invalid", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "maintenance_verification_invalid", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 422, retryable: false, operatorAction: "manual-recovery" },
  { code: "maintenance_transition_failed", domain: "maintenance", namespace: "api", owner: "worker/maintenance-control-entry.ts", httpStatus: 500, retryable: false, operatorAction: "manual-recovery" },

  { code: "backup_route_not_found", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 404, retryable: false, operatorAction: "none" },
  { code: "backup_origin_forbidden", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 403, retryable: false, operatorAction: "none" },
  { code: "backup_method_not_allowed", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 405, retryable: false, operatorAction: "none" },
  { code: "backup_request_too_large", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 413, retryable: false, operatorAction: "none" },
  { code: "backup_request_invalid", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 400, retryable: false, operatorAction: "none" },
  { code: "backup_database_unavailable", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 503, retryable: true, operatorAction: "inspect" },
  { code: "backup_schema_incompatible", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_dependency_invalid", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 422, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_domain_unsupported", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 422, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_confirmation_required", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 422, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_admin_required", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 422, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_stage_invalid", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_stage_expired", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_stage_cancelled", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_stage_committed", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_stale", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_recovery_point_invalid", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 422, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_recovery_point_stale", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 409, retryable: false, operatorAction: "manual-recovery" },
  { code: "backup_restore_commit_failed", domain: "backup-restore", namespace: "api", owner: "worker/backup-selective-restore-entry.ts", httpStatus: 500, retryable: false, operatorAction: "manual-recovery" },

  { code: "settings_revision_conflict", domain: "settings", namespace: "api", owner: "worker/settings-revisions-entry.ts", httpStatus: 409, retryable: false, operatorAction: "inspect" },
  { code: "settings_draft_not_validated", domain: "settings", namespace: "api", owner: "worker/settings-lifecycle-entry.ts", httpStatus: 409, retryable: false, operatorAction: "none" },
  { code: "settings_draft_busy", domain: "settings", namespace: "api", owner: "worker/settings-lifecycle-entry.ts", httpStatus: 409, retryable: true, operatorAction: "retry" },
  { code: "settings_draft_inactive", domain: "settings", namespace: "api", owner: "worker/settings-lifecycle-entry.ts", httpStatus: 409, retryable: false, operatorAction: "inspect" },
  { code: "settings_rollback_conflict", domain: "settings", namespace: "api", owner: "worker/settings-lifecycle-entry.ts", httpStatus: 409, retryable: false, operatorAction: "inspect" },
  { code: "settings_source_busy", domain: "settings", namespace: "api", owner: "worker/settings-source-entry.ts", httpStatus: 409, retryable: true, operatorAction: "retry" },
] as const satisfies readonly StableErrorContract[];

export type StableErrorCode = (typeof stableErrorContracts)[number]["code"];

export function getStableErrorContract(code: string, namespace?: StableErrorNamespace) {
  return stableErrorContracts.find((entry) => entry.code === code && (namespace === undefined || entry.namespace === namespace));
}
