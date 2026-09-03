import {
  canonicalBackupJson,
  sha256Hex,
  type PortalBackupDomain,
} from "../backup-manifest.ts";
import {
  BackupEncryptedExportError,
  exportEncryptedBackup,
  type EncryptedBackupDocument,
  type EncryptedBackupExportOptions,
} from "../export/backup-encrypted-export.ts";
import {
  BackupEncryptedPreviewError,
  decryptEncryptedBackupDomains,
  validateEncryptedBackupDocument,
} from "../preview/backup-encrypted-preview.ts";
import type { BackupExportEnv } from "../export/backup-export.ts";
import {
  FULL_BACKUP_TABLES,
  FullBackupValidationError,
  validateFullBackupDomainPayload,
  type FullBackupDomainExporter,
  type FullBackupDomainPayload,
} from "../export/backup-full-domains.ts";
import type { SelectiveRestorePolicyResult } from "./backup-selective-restore-policy.ts";

export class BackupSelectiveRecoveryPointError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupSelectiveRecoveryPointError";
    this.code = code;
    this.status = status;
  }
}

export type SelectiveRecoveryPointResult = {
  document: EncryptedBackupDocument;
  bindingHash: string;
  selectedDomains: PortalBackupDomain[];
  physicalDomains: PortalBackupDomain[];
  summary: { domains: number; tables: number; records: number };
};

export type VerifiedSelectiveRecoveryPoint = {
  verified: true;
  bindingHash: string;
  physicalDomains: PortalBackupDomain[];
  summary: { domains: number; tables: number; records: number };
  currentFullPayloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>;
};

type RecoveryPointDependencies = {
  exportDocument?: typeof exportEncryptedBackup;
  validateDocument?: typeof validateEncryptedBackupDocument;
  decryptDomains?: typeof decryptEncryptedBackupDomains;
};

type RecoveryPointCreateOptions = RecoveryPointDependencies & Partial<Pick<
  EncryptedBackupExportOptions,
  "createdAt" | "iterations" | "salt" | "random" | "ivForDomain"
>>;

function fail(code: string, status: number, message: string): never {
  throw new BackupSelectiveRecoveryPointError(code, status, message);
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function normalizeError(error: unknown): BackupSelectiveRecoveryPointError {
  if (error instanceof BackupSelectiveRecoveryPointError) return error;
  if (error instanceof BackupEncryptedExportError) {
    return new BackupSelectiveRecoveryPointError(error.code, error.status, "Recovery point creation failed");
  }
  if (error instanceof BackupEncryptedPreviewError || error instanceof FullBackupValidationError) {
    return new BackupSelectiveRecoveryPointError(
      "backup_recovery_point_invalid",
      422,
      "Backup recovery point is invalid",
    );
  }
  return new BackupSelectiveRecoveryPointError(
    "backup_recovery_point_invalid",
    422,
    "Backup recovery point is invalid",
  );
}

function ensurePolicy(policy: SelectiveRestorePolicyResult): void {
  if (!policy
      || !Array.isArray(policy.selectedDomains)
      || !Array.isArray(policy.physicalDomains)
      || policy.physicalDomains.length === 0
      || policy.physicalDomains.includes("rbac")
      || policy.physicalDomains.includes("audit")) {
    fail("backup_recovery_point_invalid", 422, "Backup recovery point is invalid");
  }
}

function summaryFromPayloads(
  domains: readonly PortalBackupDomain[],
  payloads: ReadonlyMap<PortalBackupDomain, { tables: Array<{ rows: unknown[][] }> }>,
): { domains: number; tables: number; records: number } {
  let tables = 0;
  let records = 0;
  for (const domain of domains) {
    const payload = payloads.get(domain);
    if (!payload) fail("backup_recovery_point_invalid", 422, "Backup recovery point is invalid");
    tables += payload.tables.length;
    records += payload.tables.reduce((total, table) => total + table.rows.length, 0);
  }
  return { domains: domains.length, tables, records };
}

function physicalTableCount(domains: readonly PortalBackupDomain[]): number {
  const counts = new Map(FULL_BACKUP_TABLES.map(([domain, tables]) => [domain, tables.length]));
  return domains.reduce((total, domain) => total + (counts.get(domain) ?? 0), 0);
}

async function manifestBinding(document: EncryptedBackupDocument): Promise<string> {
  return sha256Hex(canonicalBackupJson(document.manifest));
}

export async function createSelectiveRecoveryPoint(
  env: BackupExportEnv,
  password: unknown,
  policy: SelectiveRestorePolicyResult,
  schemaVersion: number,
  fullRegistry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>,
  options: RecoveryPointCreateOptions = {},
): Promise<SelectiveRecoveryPointResult> {
  try {
    ensurePolicy(policy);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
    }
    const document = await (options.exportDocument ?? exportEncryptedBackup)(
      env,
      {
        domains: [...policy.physicalDomains],
        password: password as string,
        schemaVersion,
        createdAt: options.createdAt,
        iterations: options.iterations,
        salt: options.salt,
        random: options.random,
        ivForDomain: options.ivForDomain,
      },
      fullRegistry,
    );
    if (!arraysEqual(document.manifest.domains, policy.physicalDomains)
        || document.manifest.schemaVersion !== schemaVersion) {
      fail("backup_recovery_point_invalid", 422, "Backup recovery point is invalid");
    }
    return {
      document,
      bindingHash: await manifestBinding(document),
      selectedDomains: [...policy.selectedDomains],
      physicalDomains: [...policy.physicalDomains],
      summary: {
        domains: policy.physicalDomains.length,
        tables: physicalTableCount(policy.physicalDomains),
        records: document.summary.records,
      },
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function verifySelectiveRecoveryPoint(
  env: BackupExportEnv,
  documentValue: unknown,
  password: unknown,
  policy: SelectiveRestorePolicyResult,
  schemaVersion: number,
  fullRegistry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>,
  dependencies: RecoveryPointDependencies = {},
): Promise<VerifiedSelectiveRecoveryPoint> {
  try {
    ensurePolicy(policy);
    if (!env.DB) fail("backup_database_unavailable", 503, "Backup database is unavailable");
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
    }

    const document = await (dependencies.validateDocument ?? validateEncryptedBackupDocument)(documentValue);
    if (document.manifest.schemaVersion !== schemaVersion) {
      fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
    }
    if (!arraysEqual(document.manifest.domains, policy.physicalDomains)) {
      fail("backup_recovery_point_invalid", 422, "Backup recovery point is invalid");
    }

    const decrypted = await (dependencies.decryptDomains ?? decryptEncryptedBackupDomains)(
      document,
      password,
      policy.physicalDomains,
    );
    if (!arraysEqual(decrypted.selectedDomains, policy.physicalDomains)) {
      fail("backup_recovery_point_invalid", 422, "Backup recovery point is invalid");
    }

    const currentFullPayloads = new Map<PortalBackupDomain, FullBackupDomainPayload>();
    for (const domain of policy.physicalDomains) {
      const incoming = decrypted.fullPayloads.get(domain);
      const exporter = fullRegistry.get(domain);
      if (!incoming || !exporter || exporter.domain !== domain || exporter.path !== `domains/${domain}.json`) {
        fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
      }
      const validatedIncoming = validateFullBackupDomainPayload(domain, incoming);
      const currentExport = await exporter.export(env, schemaVersion);
      const current = validateFullBackupDomainPayload(domain, currentExport.payload);
      const currentRecords = current.tables.reduce((total, table) => total + table.rows.length, 0);
      if (currentRecords !== currentExport.records) {
        fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
      }
      const [incomingHash, currentHash] = await Promise.all([
        sha256Hex(canonicalBackupJson(validatedIncoming)),
        sha256Hex(canonicalBackupJson(current)),
      ]);
      if (incomingHash !== currentHash) {
        fail("backup_recovery_point_stale", 409, "Backup recovery point is stale");
      }
      currentFullPayloads.set(domain, current);
    }

    return {
      verified: true,
      bindingHash: await manifestBinding(document),
      physicalDomains: [...policy.physicalDomains],
      summary: summaryFromPayloads(policy.physicalDomains, decrypted.fullPayloads),
      currentFullPayloads,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
