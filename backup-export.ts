import {
  PORTAL_BACKUP_DOMAINS,
  PORTAL_BACKUP_FORMAT,
  PORTAL_BACKUP_VERSION,
  assertSanitizedBackupPayload,
  createBackupEntry,
  validateBackupManifest,
  type PortalBackupDomain,
  type PortalBackupEntry,
  type PortalBackupManifest,
} from "./backup-manifest.ts";

export class BackupExportError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupExportError";
    this.code = code;
    this.status = status;
  }
}

export type BackupExportRequest = {
  domains: PortalBackupDomain[];
};

export type BackupExportEnv = {
  DB?: D1Database;
};

export type PortalBackupDomainExporter = {
  domain: PortalBackupDomain;
  path: `domains/${string}.json`;
  export(env: BackupExportEnv): Promise<{ payload: unknown; records: number }>;
};

export type SanitizedBackupDocument = {
  manifest: PortalBackupManifest;
  payloads: Record<string, unknown>;
  summary: {
    entries: number;
    records: number;
    bytes: number;
  };
};

export type SanitizedBackupExportOptions = BackupExportRequest & {
  schemaVersion: number;
  createdAt?: string;
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

export async function exportSanitizedBackup(
  env: BackupExportEnv,
  options: SanitizedBackupExportOptions,
  registry: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>,
): Promise<SanitizedBackupDocument> {
  if (!env.DB) {
    throw new BackupExportError("backup_database_unavailable", 503, "Backup database is unavailable");
  }

  if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1) {
    throw new BackupExportError("backup_schema_incompatible", 409, "Backup schema version is unavailable");
  }

  const domains = PORTAL_BACKUP_DOMAINS.filter((domain) => options.domains.includes(domain));
  const payloads: Record<string, unknown> = {};
  const entries: PortalBackupEntry[] = [];

  for (const domain of domains) {
    const exporter = registry.get(domain);
    if (!exporter || exporter.domain !== domain) {
      throw new BackupExportError("backup_schema_incompatible", 409, `Backup domain is unavailable: ${domain}`);
    }

    const result = await exporter.export(env);
    assertSanitizedBackupPayload(result.payload);
    const entry = await createBackupEntry({
      domain,
      path: exporter.path,
      payload: result.payload,
      records: result.records,
    });
    entries.push(entry);
    payloads[exporter.path] = result.payload;
  }

  const manifest = validateBackupManifest({
    format: PORTAL_BACKUP_FORMAT,
    version: PORTAL_BACKUP_VERSION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    schemaVersion: options.schemaVersion,
    mode: "sanitized",
    domains,
    entries,
    encryption: null,
  });

  return {
    manifest,
    payloads,
    summary: {
      entries: entries.length,
      records: entries.reduce((sum, entry) => sum + entry.records, 0),
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  };
}
