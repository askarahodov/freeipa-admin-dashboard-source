import {
  PORTAL_BACKUP_DOMAINS,
  PORTAL_BACKUP_FORMAT,
  PORTAL_BACKUP_VERSION,
  createBackupEntry,
  validateBackupManifest,
  type PortalBackupDomain,
  type PortalBackupEntry,
  type PortalBackupManifest,
} from "../../../backup-manifest.ts";
import {
  BACKUP_KDF_ITERATIONS,
  BackupEncryptionError,
  createBackupSalt,
  deriveBackupKey,
  encryptBackupPayload,
  validateBackupPassword,
  validateEncryptedDocumentBytes,
  type BackupCryptoRandom,
  type EncryptedPayloadEnvelope,
} from "../crypto/backup-encryption.ts";
import { validateFullBackupDomainPayload, type FullBackupDomainExporter } from "../../../backup-full-domains.ts";
import type { BackupExportEnv } from "./backup-export.ts";

export class BackupEncryptedExportError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupEncryptedExportError";
    this.code = code;
    this.status = status;
  }
}

export type EncryptedBackupExportRequest = { domains: PortalBackupDomain[]; password: string };
export type EncryptedBackupDocument = { manifest: PortalBackupManifest; payloads: Record<string, EncryptedPayloadEnvelope>; summary: { entries: number; records: number; bytes: number } };
export type EncryptedBackupExportOptions = EncryptedBackupExportRequest & { schemaVersion: number; createdAt?: string; iterations?: number; salt?: string; random?: BackupCryptoRandom; ivForDomain?: (domain: PortalBackupDomain) => string };

function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function requestInvalid(message: string): never { throw new BackupEncryptedExportError("backup_request_invalid", 400, message); }

export function parseEncryptedBackupExportRequest(value: unknown): EncryptedBackupExportRequest {
  if (!plainObject(value)) requestInvalid("Encrypted backup export request must be an object");
  if (Object.keys(value).some((key) => key !== "domains" && key !== "password") || !Object.hasOwn(value, "domains") || !Object.hasOwn(value, "password")) requestInvalid("Encrypted backup export request contains invalid fields");
  if (!Array.isArray(value.domains) || value.domains.length === 0 || value.domains.some((domain) => typeof domain !== "string")) requestInvalid("Backup domains must be a non-empty array");
  const requested = value.domains as string[];
  if (new Set(requested).size !== requested.length) requestInvalid("Duplicate backup domains");
  for (const domain of requested) if (!PORTAL_BACKUP_DOMAINS.includes(domain as PortalBackupDomain)) requestInvalid("Unsupported backup domain");
  try { validateBackupPassword(value.password); } catch { requestInvalid("Backup password is invalid"); }
  return { domains: PORTAL_BACKUP_DOMAINS.filter((domain) => requested.includes(domain)), password: value.password as string };
}

function normalizedFailure(error: unknown): BackupEncryptedExportError {
  if (error instanceof BackupEncryptedExportError) return error;
  if (error instanceof BackupEncryptionError) return new BackupEncryptedExportError(error.code, error.status, error.message);
  return new BackupEncryptedExportError("backup_encrypted_export_failed", 500, "Encrypted backup export failed");
}

export async function exportEncryptedBackup(env: BackupExportEnv, options: EncryptedBackupExportOptions, registry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>): Promise<EncryptedBackupDocument> {
  try {
    if (!env.DB) throw new BackupEncryptedExportError("backup_database_unavailable", 503, "Backup database is unavailable");
    if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1) throw new BackupEncryptedExportError("backup_schema_incompatible", 409, "Backup schema is incompatible");
    const parsed = parseEncryptedBackupExportRequest({ domains: options.domains, password: options.password });
    const iterations = options.iterations ?? BACKUP_KDF_ITERATIONS;
    const salt = options.salt ?? createBackupSalt(options.random);
    const key = await deriveBackupKey(parsed.password, salt, iterations);
    const payloads: Record<string, EncryptedPayloadEnvelope> = {};
    const entries: PortalBackupEntry[] = [];

    for (const domain of parsed.domains) {
      const exporter = registry.get(domain);
      const path = `domains/${domain}.json` as const;
      if (!exporter || exporter.domain !== domain || exporter.path !== path) throw new BackupEncryptedExportError("backup_schema_incompatible", 409, "Backup domain is unavailable");
      const exported = await exporter.export(env, options.schemaVersion);
      const fullPayload = validateFullBackupDomainPayload(domain, exported.payload);
      const records = fullPayload.tables.reduce((total, table) => total + table.rows.length, 0);
      if (records !== exported.records) throw new BackupEncryptedExportError("backup_schema_incompatible", 409, "Backup record count is inconsistent");
      const envelope = await encryptBackupPayload({ key, context: { format: PORTAL_BACKUP_FORMAT, version: PORTAL_BACKUP_VERSION, schemaVersion: options.schemaVersion, domain, path }, payload: fullPayload, iv: options.ivForDomain?.(domain), random: options.random });
      entries.push(await createBackupEntry({ domain, path, payload: envelope, records }));
      validateEncryptedDocumentBytes(entries.reduce((total, entry) => total + entry.bytes, 0));
      payloads[path] = envelope;
    }

    const manifest = validateBackupManifest({
      format: PORTAL_BACKUP_FORMAT,
      version: PORTAL_BACKUP_VERSION,
      createdAt: options.createdAt ?? new Date().toISOString(),
      schemaVersion: options.schemaVersion,
      mode: "encrypted",
      domains: parsed.domains,
      entries,
      encryption: { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations, salt },
    });
    return { manifest, payloads, summary: { entries: entries.length, records: entries.reduce((total, entry) => total + entry.records, 0), bytes: entries.reduce((total, entry) => total + entry.bytes, 0) } };
  } catch (error) {
    throw normalizedFailure(error);
  }
}
