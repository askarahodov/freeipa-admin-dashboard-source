import {
  PORTAL_BACKUP_DOMAINS,
  type PortalBackupDomain,
} from "../../../backup-manifest.ts";

export class BackupSelectiveRestorePolicyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupSelectiveRestorePolicyError";
    this.code = code;
    this.status = status;
  }
}

export type SelectiveRestorePolicyResult = {
  selectedDomains: PortalBackupDomain[];
  physicalDomains: PortalBackupDomain[];
  sessionPolicy: "revoke";
  operationApprovalBundle: boolean;
};

const supported = new Set<PortalBackupDomain>(PORTAL_BACKUP_DOMAINS);

function fail(code: string, message: string): never {
  throw new BackupSelectiveRestorePolicyError(code, 422, message);
}

export function validateSelectiveRestoreDomains(value: unknown): SelectiveRestorePolicyResult {
  if (!Array.isArray(value) || value.length === 0) {
    fail("backup_restore_dependency_invalid", "Selective restore domains are invalid");
  }

  const requested = value.map((item) => {
    if (typeof item !== "string" || !supported.has(item as PortalBackupDomain)) {
      fail("backup_restore_dependency_invalid", "Selective restore domains are invalid");
    }
    return item as PortalBackupDomain;
  });

  if (new Set(requested).size !== requested.length) {
    fail("backup_restore_dependency_invalid", "Selective restore domains are invalid");
  }
  if (requested.includes("audit")) {
    fail("backup_restore_domain_unsupported", "Audit requires destructive restore mode");
  }

  const selected = PORTAL_BACKUP_DOMAINS.filter((domain) => requested.includes(domain));
  const hasLocalAuth = selected.includes("local-auth");
  const hasRbac = selected.includes("rbac");
  const hasOperations = selected.includes("operations");
  const hasApprovals = selected.includes("approvals");

  if (hasRbac && !hasLocalAuth) {
    fail("backup_restore_dependency_invalid", "RBAC restore requires local authentication");
  }
  if (hasOperations !== hasApprovals) {
    fail("backup_restore_dependency_invalid", "Operations and approvals must be restored together");
  }

  return {
    selectedDomains: [...selected],
    physicalDomains: selected.filter((domain) => domain !== "rbac"),
    sessionPolicy: "revoke",
    operationApprovalBundle: hasOperations && hasApprovals,
  };
}
