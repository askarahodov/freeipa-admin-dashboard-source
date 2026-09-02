import type { EncryptedBackupDocument } from "./backup-encrypted-export.ts";
import type { BackupExportEnv } from "./src/backup/export/backup-export.ts";
import {
  validateFullBackupDomainPayload,
  type FullBackupDomainExporter,
} from "./backup-full-domains.ts";
import {
  canonicalBackupJson,
  sha256Hex,
  type PortalBackupDomain,
} from "./backup-manifest.ts";
import { selectBackupRestoreDomains } from "./backup-restore-selection.ts";

export const BACKUP_RESTORE_PLAN_VERSION = 1 as const;

export class BackupRestorePlanError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupRestorePlanError";
    this.code = code;
    this.status = status;
  }
}

export type BackupRestorePlan = {
  version: typeof BACKUP_RESTORE_PLAN_VERSION;
  selectedDomains: PortalBackupDomain[];
  approvalToken: string;
};

function fail(code: string, status: number, message: string): never {
  throw new BackupRestorePlanError(code, status, message);
}

function normalizedFailure(error: unknown): BackupRestorePlanError {
  if (error instanceof BackupRestorePlanError) return error;
  return new BackupRestorePlanError(
    "backup_schema_incompatible",
    409,
    "Backup restore plan cannot be created from the current schema",
  );
}

export async function createBackupRestorePlan(
  env: BackupExportEnv,
  document: EncryptedBackupDocument,
  selectedDomainsValue: unknown,
  currentSchemaVersion: number,
  fullRegistry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>,
): Promise<BackupRestorePlan> {
  try {
    if (!document || typeof document !== "object" || !document.manifest) {
      fail("backup_request_invalid", 400, "Backup document is invalid");
    }
    if (!Number.isSafeInteger(currentSchemaVersion) || currentSchemaVersion < 1) {
      fail("backup_schema_incompatible", 409, "Current portal schema is incompatible");
    }

    const selectedDomains = selectBackupRestoreDomains(
      document.manifest.domains,
      selectedDomainsValue,
    );
    const selectedEntries = selectedDomains.map((domain) => {
      const entry = document.manifest.entries.find((item) => item.domain === domain);
      if (!entry || entry.path !== `domains/${domain}.json`) {
        fail("backup_request_invalid", 400, "Backup manifest entry is unavailable");
      }
      return {
        domain: entry.domain,
        path: entry.path,
        sha256: entry.sha256,
        bytes: entry.bytes,
        records: entry.records,
      };
    });

    const currentDomains: Array<{
      domain: PortalBackupDomain;
      sha256: string;
      records: number;
    }> = [];

    for (const domain of selectedDomains) {
      const exporter = fullRegistry.get(domain);
      if (!exporter || exporter.domain !== domain || exporter.path !== `domains/${domain}.json`) {
        fail("backup_schema_incompatible", 409, "Current backup domain is unavailable");
      }
      const exported = await exporter.export(env, currentSchemaVersion);
      const payload = validateFullBackupDomainPayload(domain, exported.payload);
      const records = payload.tables.reduce((total, table) => total + table.rows.length, 0);
      if (records !== exported.records) {
        fail("backup_schema_incompatible", 409, "Current backup domain record count is inconsistent");
      }
      currentDomains.push({
        domain,
        sha256: await sha256Hex(canonicalBackupJson(payload)),
        records,
      });
    }

    const tokenMaterial = {
      version: BACKUP_RESTORE_PLAN_VERSION,
      backup: {
        format: document.manifest.format,
        version: document.manifest.version,
        mode: document.manifest.mode,
        schemaVersion: document.manifest.schemaVersion,
        domains: selectedDomains,
        entries: selectedEntries,
      },
      current: {
        schemaVersion: currentSchemaVersion,
        domains: currentDomains,
      },
    };

    return {
      version: BACKUP_RESTORE_PLAN_VERSION,
      selectedDomains: [...selectedDomains],
      approvalToken: await sha256Hex(canonicalBackupJson(tokenMaterial)),
    };
  } catch (error) {
    throw normalizedFailure(error);
  }
}

function strictToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function tokenBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function verifyBackupRestoreApprovalToken(expected: string, provided: unknown): boolean {
  const expectedValid = strictToken(expected);
  const providedValid = strictToken(provided);
  const left = tokenBytes(expectedValid ? expected : "0".repeat(64));
  const right = tokenBytes(providedValid ? provided : "0".repeat(64));
  let difference = expectedValid && providedValid ? 0 : 1;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
