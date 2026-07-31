import {
  PORTAL_BACKUP_DOMAINS,
  canonicalBackupJson,
  sha256Hex,
  validateBackupManifest,
  type PortalBackupDomain,
} from "./backup-manifest.ts";
import {
  BackupEncryptionError,
  decryptBackupPayload,
  deriveBackupKey,
  validateEncryptedDocumentBytes,
  validateEncryptedEnvelope,
  type EncryptedPayloadEnvelope,
} from "./backup-encryption.ts";
import { FullBackupValidationError, validateFullBackupDomainPayload } from "./backup-full-domains.ts";
import { projectFullBackupDomain } from "./backup-full-projections.ts";
import {
  previewBackupImport,
  type BackupImportDocument,
  type BackupImportPreviewResult,
  type BackupPreviewSchema,
} from "./backup-import-preview.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "./backup-export.ts";
import type { EncryptedBackupDocument } from "./backup-encrypted-export.ts";

export class BackupEncryptedPreviewError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupEncryptedPreviewError";
    this.code = code;
    this.status = status;
  }
}

export type ValidatedEncryptedBackupDocument = EncryptedBackupDocument;
type EncryptedPreviewDependencies = { deriveKey?: typeof deriveBackupKey; decrypt?: typeof decryptBackupPayload; preview?: typeof previewBackupImport };
function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function fail(code: string, status: number, message: string): never { throw new BackupEncryptedPreviewError(code, status, message); }
function canonicalDomains(domains: readonly PortalBackupDomain[]): PortalBackupDomain[] { return PORTAL_BACKUP_DOMAINS.filter((domain) => domains.includes(domain)); }
function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean { return left.length === right.length && left.every((item, index) => item === right[index]); }
function mapValidationError(error: unknown): never {
  if (error instanceof BackupEncryptedPreviewError) throw error;
  if (error instanceof BackupEncryptionError) fail("backup_request_invalid", 400, "Encrypted backup document is invalid");
  fail("backup_request_invalid", 400, "Encrypted backup document is invalid");
}

export async function validateEncryptedBackupDocument(value: unknown): Promise<ValidatedEncryptedBackupDocument> {
  if (!plainObject(value)) fail("backup_request_invalid", 400, "Encrypted backup document must be an object");
  if (Object.keys(value).some((key) => !["manifest", "payloads", "summary"].includes(key)) || !Object.hasOwn(value, "manifest") || !Object.hasOwn(value, "payloads") || !Object.hasOwn(value, "summary")) fail("backup_request_invalid", 400, "Encrypted backup document contains invalid fields");
  let manifest;
  try { manifest = validateBackupManifest(value.manifest); } catch (error) { mapValidationError(error); }
  if (manifest.mode !== "encrypted" || !manifest.encryption) fail("backup_mode_unsupported", 422, "Encrypted backup mode is required");
  if (!arraysEqual(manifest.domains, canonicalDomains(manifest.domains)) || manifest.entries.length !== manifest.domains.length) fail("backup_request_invalid", 400, "Encrypted backup domains and entries must be canonical");
  if (!plainObject(value.payloads)) fail("backup_request_invalid", 400, "Encrypted backup payloads must be an object");
  const payloads = value.payloads as Record<string, unknown>;
  const validatedPayloads: Record<string, EncryptedPayloadEnvelope> = {};
  const expectedPaths = new Set<string>();
  let records = 0;
  let bytes = 0;
  for (let index = 0; index < manifest.domains.length; index += 1) {
    const domain = manifest.domains[index];
    const entry = manifest.entries[index];
    const path = `domains/${domain}.json`;
    if (entry.domain !== domain || entry.path !== path) fail("backup_request_invalid", 400, "Encrypted backup entries are not canonical");
    expectedPaths.add(path);
    if (!Object.hasOwn(payloads, path)) fail("backup_payload_missing", 422, "Encrypted backup payload is missing");
    let envelope: EncryptedPayloadEnvelope;
    try { envelope = validateEncryptedEnvelope(payloads[path]); } catch { fail("backup_request_invalid", 400, "Encrypted backup payload is invalid"); }
    const canonical = canonicalBackupJson(envelope);
    const envelopeBytes = new TextEncoder().encode(canonical).byteLength;
    const checksum = await sha256Hex(canonical);
    if (entry.bytes !== envelopeBytes || entry.sha256 !== checksum) fail("backup_decryption_failed", 422, "Backup decryption failed");
    validatedPayloads[path] = envelope;
    records += entry.records;
    bytes += entry.bytes;
  }
  for (const path of Object.keys(payloads)) if (!expectedPaths.has(path)) fail("backup_payload_unexpected", 422, "Encrypted backup contains an unexpected payload");
  validateEncryptedDocumentBytes(bytes);
  if (!plainObject(value.summary)
      || Object.keys(value.summary).some((key) => !["entries", "records", "bytes"].includes(key))
      || !Number.isSafeInteger(value.summary.entries) || !Number.isSafeInteger(value.summary.records) || !Number.isSafeInteger(value.summary.bytes)
      || Number(value.summary.entries) !== manifest.entries.length || Number(value.summary.records) !== records || Number(value.summary.bytes) !== bytes) {
    fail("backup_corrupted", 422, "Encrypted backup summary is inconsistent");
  }
  return { manifest, payloads: validatedPayloads, summary: { entries: Number(value.summary.entries), records: Number(value.summary.records), bytes: Number(value.summary.bytes) } };
}

function normalizedDecryptFailure(error: unknown): BackupEncryptedPreviewError {
  if (error instanceof BackupEncryptedPreviewError) return error;
  if (error instanceof BackupEncryptionError && error.code === "backup_decryption_failed") return new BackupEncryptedPreviewError("backup_decryption_failed", 422, "Backup decryption failed");
  if (error instanceof FullBackupValidationError) return new BackupEncryptedPreviewError("backup_full_payload_invalid", 422, "Encrypted backup payload is invalid");
  return new BackupEncryptedPreviewError("backup_decryption_failed", 422, "Backup decryption failed");
}

export async function decryptEncryptedBackupDocument(value: unknown, password: unknown, dependencies: EncryptedPreviewDependencies = {}): Promise<BackupImportDocument> {
  const document = await validateEncryptedBackupDocument(value);
  const encryption = document.manifest.encryption!;
  try {
    const key = await (dependencies.deriveKey ?? deriveBackupKey)(password, encryption.salt, encryption.iterations);
    const projectedPayloads: Record<string, unknown> = {};
    for (const domain of document.manifest.domains) {
      const path = `domains/${domain}.json`;
      const plaintext = await (dependencies.decrypt ?? decryptBackupPayload)({ key, context: { format: document.manifest.format, version: document.manifest.version, schemaVersion: document.manifest.schemaVersion, domain, path }, envelope: document.payloads[path] });
      const fullPayload = validateFullBackupDomainPayload(domain, plaintext);
      const entry = document.manifest.entries.find((item) => item.domain === domain);
      const actualRecords = fullPayload.tables.reduce((total, item) => total + item.rows.length, 0);
      if (!entry || entry.records !== actualRecords) fail("backup_full_payload_invalid", 422, "Encrypted backup payload record count is inconsistent");
      if (fullPayload.schemaVersion !== document.manifest.schemaVersion) fail("backup_full_payload_invalid", 422, "Encrypted backup payload schema is inconsistent");
      projectedPayloads[path] = projectFullBackupDomain(domain, fullPayload);
    }
    return { manifest: document.manifest, payloads: projectedPayloads, summary: document.summary };
  } catch (error) {
    throw normalizedDecryptFailure(error);
  }
}

export async function previewEncryptedBackupImport(env: BackupExportEnv, value: unknown, password: unknown, schema: BackupPreviewSchema, registry: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>, dependencies: EncryptedPreviewDependencies = {}): Promise<BackupImportPreviewResult> {
  const document = await validateEncryptedBackupDocument(value);
  if (!env.DB) fail("backup_database_unavailable", 503, "Backup database is unavailable");
  if (schema.state !== "ready" || !Number.isSafeInteger(schema.currentVersion) || schema.currentVersion < 1) fail("backup_schema_incompatible", 409, "Current portal schema is incompatible");
  if (document.manifest.schemaVersion > schema.currentVersion) fail("backup_schema_incompatible", 409, "Backup schema is newer than the current portal schema");
  const projected = await decryptEncryptedBackupDocument(document, password, dependencies);
  return (dependencies.preview ?? previewBackupImport)(env, projected, schema, registry);
}
