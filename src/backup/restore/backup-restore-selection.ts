import { PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "../../../backup-manifest.ts";

export class BackupRestoreSelectionError extends Error {
  readonly code = "backup_request_invalid";
  readonly status = 400;

  constructor(message = "Backup restore domain selection is invalid") {
    super(message);
    this.name = "BackupRestoreSelectionError";
  }
}

function fail(message: string): never {
  throw new BackupRestoreSelectionError(message);
}

function canonicalDomains(value: readonly PortalBackupDomain[]): PortalBackupDomain[] {
  return PORTAL_BACKUP_DOMAINS.filter((domain) => value.includes(domain));
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function selectBackupRestoreDomains(
  manifestDomainsValue: unknown,
  requestedDomainsValue: unknown,
): PortalBackupDomain[] {
  if (!Array.isArray(manifestDomainsValue)
      || manifestDomainsValue.length === 0
      || manifestDomainsValue.some((domain) => typeof domain !== "string")) {
    fail("Backup manifest domains are invalid");
  }

  const manifestStrings = manifestDomainsValue as string[];
  if (new Set(manifestStrings).size !== manifestStrings.length
      || manifestStrings.some((domain) => !PORTAL_BACKUP_DOMAINS.includes(domain as PortalBackupDomain))) {
    fail("Backup manifest domains are invalid");
  }

  const manifestDomains = manifestStrings as PortalBackupDomain[];
  if (!sameArray(manifestDomains, canonicalDomains(manifestDomains))) {
    fail("Backup manifest domains are not canonical");
  }

  if (typeof requestedDomainsValue === "undefined") return [...manifestDomains];
  if (!Array.isArray(requestedDomainsValue)
      || requestedDomainsValue.length === 0
      || requestedDomainsValue.some((domain) => typeof domain !== "string")) {
    fail("Backup restore domains must be a non-empty array");
  }

  const requestedStrings = requestedDomainsValue as string[];
  if (new Set(requestedStrings).size !== requestedStrings.length) {
    fail("Backup restore domains must not contain duplicates");
  }

  for (const domain of requestedStrings) {
    if (!PORTAL_BACKUP_DOMAINS.includes(domain as PortalBackupDomain) || !manifestDomains.includes(domain as PortalBackupDomain)) {
      fail("Backup restore domain is unavailable");
    }
  }

  return canonicalDomains(requestedStrings as PortalBackupDomain[]);
}
