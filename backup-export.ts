import { PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "./backup-manifest";

export class BackupExportError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BackupExportError";
  }
}

export type BackupExportRequest = {
  domains: PortalBackupDomain[];
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseBackupExportRequest(value: unknown): BackupExportRequest {
  if (!plainObject(value)) {
    throw new BackupExportError("backup_request_invalid", 400, "Backup export request must be an object");
  }

  for (const key of Object.keys(value)) {
    if (key !== "domains") {
      throw new BackupExportError("backup_request_invalid", 400, `Unknown request field: ${key}`);
    }
  }

  if (!Array.isArray(value.domains) || value.domains.length === 0) {
    throw new BackupExportError("backup_request_invalid", 400, "Backup domains must be a non-empty array");
  }

  if (value.domains.some((domain) => typeof domain !== "string")) {
    throw new BackupExportError("backup_request_invalid", 400, "Backup domains must contain only strings");
  }

  const requested = value.domains as string[];
  if (new Set(requested).size !== requested.length) {
    throw new BackupExportError("backup_request_invalid", 400, "Duplicate backup domains");
  }

  for (const domain of requested) {
    if (!PORTAL_BACKUP_DOMAINS.includes(domain as PortalBackupDomain)) {
      throw new BackupExportError("backup_request_invalid", 400, `Unsupported backup domain: ${domain}`);
    }
  }

  return {
    domains: PORTAL_BACKUP_DOMAINS.filter((domain) => requested.includes(domain)),
  };
}
