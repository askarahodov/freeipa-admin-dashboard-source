import {
  PORTAL_BACKUP_DOMAINS,
  assertSanitizedBackupPayload,
  canonicalBackupJson,
  sha256Hex,
  validateBackupManifest,
  type PortalBackupDomain,
  type PortalBackupManifest,
} from "./backup-manifest.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "./src/backup/export/backup-export.ts";

const MAX_CONFLICT_SAMPLES = 20;
const topLevelFields = new Set(["manifest", "payloads", "summary"]);

export class BackupImportPreviewError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupImportPreviewError";
    this.code = code;
    this.status = status;
  }
}

export type BackupImportDocument = {
  manifest: PortalBackupManifest;
  payloads: Record<string, unknown>;
  summary: {
    entries: number;
    records: number;
    bytes: number;
  };
};

export type BackupPreviewSchema = {
  state: string;
  currentVersion: number;
  latestVersion?: number;
  appliedVersions?: number[];
};

export type BackupDomainPreview = {
  domain: PortalBackupDomain;
  incomingRecords: number;
  currentRecords: number;
  add: number;
  update: number;
  unchanged: number;
  conflict: number;
  removeIgnored: number;
  conflicts: Array<{ id: string }>;
};

export type BackupImportPreviewResult = {
  backup: {
    format: string;
    version: number;
    createdAt: string;
    sourceSchemaVersion: number;
    currentSchemaVersion: number;
  };
  selectedDomains: PortalBackupDomain[];
  requiredMigrations: number[];
  canRestore: boolean;
  summary: {
    add: number;
    update: number;
    unchanged: number;
    conflict: number;
    removeIgnored: number;
  };
  domains: BackupDomainPreview[];
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function fail(code: string, status: number, message: string): never {
  throw new BackupImportPreviewError(code, status, message);
}

function payloadRecords(value: unknown, errorCode: string): Record<string, unknown>[] {
  if (!plainObject(value) || Object.keys(value).some((key) => key !== "records") || !Array.isArray(value.records)) {
    fail(errorCode, 422, "Backup domain payload must contain only a records array");
  }
  if (value.records.some((record) => !plainObject(record))) {
    fail(errorCode, 422, "Backup domain records must be objects");
  }
  return value.records as Record<string, unknown>[];
}

function canonicalDomains(domains: readonly PortalBackupDomain[]): PortalBackupDomain[] {
  return PORTAL_BACKUP_DOMAINS.filter((domain) => domains.includes(domain));
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function mapManifestError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Backup manifest is invalid";
  fail("backup_request_invalid", 400, message);
}

export async function validateBackupImportDocument(value: unknown): Promise<BackupImportDocument> {
  if (!plainObject(value)) fail("backup_request_invalid", 400, "Backup import request must be an object");
  for (const key of Object.keys(value)) {
    if (!topLevelFields.has(key)) fail("backup_request_invalid", 400, `Unknown backup document field: ${key}`);
  }
  if (!Object.hasOwn(value, "manifest") || !Object.hasOwn(value, "payloads") || !Object.hasOwn(value, "summary")) {
    fail("backup_request_invalid", 400, "Backup document requires manifest, payloads and summary");
  }

  let manifest: PortalBackupManifest;
  try {
    manifest = validateBackupManifest(value.manifest);
  } catch (error) {
    mapManifestError(error);
  }

  if (manifest.mode !== "sanitized") {
    fail("backup_mode_unsupported", 422, "Only sanitized backups are supported for preview");
  }

  const orderedDomains = canonicalDomains(manifest.domains);
  if (!arraysEqual(manifest.domains, orderedDomains)) {
    fail("backup_request_invalid", 400, "Backup domains must use canonical order");
  }
  if (manifest.entries.length !== manifest.domains.length) {
    fail("backup_request_invalid", 400, "Backup must contain exactly one entry per domain");
  }

  if (!plainObject(value.payloads)) fail("backup_request_invalid", 400, "Backup payloads must be an object");
  const payloads = value.payloads as Record<string, unknown>;
  const expectedPaths = new Set<string>();
  let totalRecords = 0;
  let totalBytes = 0;

  for (let index = 0; index < manifest.domains.length; index += 1) {
    const domain = manifest.domains[index];
    const entry = manifest.entries[index];
    const expectedPath = `domains/${domain}.json`;
    if (entry.domain !== domain || entry.path !== expectedPath) {
      fail("backup_request_invalid", 400, "Backup entries must match canonical domains and paths");
    }
    expectedPaths.add(expectedPath);
    if (!Object.hasOwn(payloads, expectedPath)) {
      fail("backup_payload_missing", 422, `Backup payload is missing: ${expectedPath}`);
    }

    const payload = payloads[expectedPath];
    let records: Record<string, unknown>[];
    try {
      assertSanitizedBackupPayload(payload);
      records = payloadRecords(payload, "backup_request_invalid");
    } catch (error) {
      if (error instanceof BackupImportPreviewError) throw error;
      fail("backup_payload_unsafe", 422, "Backup payload contains forbidden fields");
    }

    const canonical = canonicalBackupJson(payload);
    const bytes = new TextEncoder().encode(canonical).byteLength;
    const checksum = await sha256Hex(canonical);
    if (entry.bytes !== bytes || entry.sha256 !== checksum || entry.records !== records.length) {
      fail("backup_corrupted", 422, `Backup payload integrity check failed: ${expectedPath}`);
    }
    totalRecords += records.length;
    totalBytes += bytes;
  }

  for (const path of Object.keys(payloads)) {
    if (!expectedPaths.has(path)) fail("backup_payload_unexpected", 422, `Unexpected backup payload: ${path}`);
  }

  if (!plainObject(value.summary)) fail("backup_request_invalid", 400, "Backup summary must be an object");
  const summary = value.summary as Record<string, unknown>;
  if (Object.keys(summary).some((key) => !["entries", "records", "bytes"].includes(key))) {
    fail("backup_request_invalid", 400, "Backup summary contains unknown fields");
  }
  if (!nonNegativeInteger(summary.entries) || !nonNegativeInteger(summary.records) || !nonNegativeInteger(summary.bytes)) {
    fail("backup_request_invalid", 400, "Backup summary values must be non-negative integers");
  }
  if (summary.entries !== manifest.entries.length || summary.records !== totalRecords || summary.bytes !== totalBytes) {
    fail("backup_corrupted", 422, "Backup summary does not match manifest entries");
  }

  return {
    manifest,
    payloads,
    summary: { entries: summary.entries, records: summary.records, bytes: summary.bytes },
  };
}

function stablePart(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function recordIdentity(domain: PortalBackupDomain, record: Record<string, unknown>): string {
  const id = stablePart(record.id);
  switch (domain) {
    case "settings": return id;
    case "local-auth": return id || stablePart(record.username);
    case "rbac": return stablePart(record.identity_id) || id || stablePart(record.username);
    case "policies": return [stablePart(record.type), id].filter(Boolean).join(":");
    case "catalog": return [stablePart(record.type), id].filter(Boolean).join(":");
    case "operations": {
      const type = stablePart(record.type);
      if (type === "result") return [type, stablePart(record.run_id), stablePart(record.job_id)].filter(Boolean).join(":");
      return [type, id].filter(Boolean).join(":");
    }
    case "approvals": {
      const type = stablePart(record.type);
      if (type === "decision") return [type, stablePart(record.approval_id), stablePart(record.approver_identity)].filter(Boolean).join(":");
      return [type, id].filter(Boolean).join(":");
    }
    case "audit": return id;
  }
}

function versionNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function recordVersion(record: Record<string, unknown>): number | null {
  for (const key of ["updated_at", "updatedAt", "synced_at", "decided_at", "captured_at", "completed_at", "created_at"]) {
    const value = versionNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function indexRecords(
  domain: PortalBackupDomain,
  records: Record<string, unknown>[],
  source: "backup" | "current",
): Map<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const identity = recordIdentity(domain, record);
    if (!identity || identity.length > 500 || indexed.has(identity)) {
      const code = source === "backup" ? "backup_payload_invalid" : "backup_schema_incompatible";
      const status = source === "backup" ? 422 : 409;
      fail(code, status, `Backup preview cannot identify ${domain} records safely`);
    }
    indexed.set(identity, record);
  }
  return indexed;
}

function emptySummary(): BackupImportPreviewResult["summary"] {
  return { add: 0, update: 0, unchanged: 0, conflict: 0, removeIgnored: 0 };
}

function compareDomain(
  domain: PortalBackupDomain,
  incoming: Record<string, unknown>[],
  current: Record<string, unknown>[],
): BackupDomainPreview {
  const incomingById = indexRecords(domain, incoming, "backup");
  const currentById = indexRecords(domain, current, "current");
  const counts = emptySummary();
  const conflictIds: string[] = [];

  for (const identity of [...incomingById.keys()].sort()) {
    const incomingRecord = incomingById.get(identity)!;
    const currentRecord = currentById.get(identity);
    if (!currentRecord) {
      counts.add += 1;
      continue;
    }
    if (canonicalBackupJson(incomingRecord) === canonicalBackupJson(currentRecord)) {
      counts.unchanged += 1;
      continue;
    }
    const incomingVersion = recordVersion(incomingRecord);
    const currentVersion = recordVersion(currentRecord);
    if (incomingVersion !== null && currentVersion !== null && currentVersion > incomingVersion) {
      counts.conflict += 1;
      conflictIds.push(identity);
    } else {
      counts.update += 1;
    }
  }

  for (const identity of currentById.keys()) {
    if (!incomingById.has(identity)) counts.removeIgnored += 1;
  }

  return {
    domain,
    incomingRecords: incoming.length,
    currentRecords: current.length,
    ...counts,
    conflicts: conflictIds.sort().slice(0, MAX_CONFLICT_SAMPLES).map((id) => ({ id })),
  };
}

function requiredMigrations(sourceVersion: number, schema: BackupPreviewSchema): number[] {
  if (sourceVersion >= schema.currentVersion) return [];
  if (Array.isArray(schema.appliedVersions) && schema.appliedVersions.length) {
    const known = new Set(schema.appliedVersions.filter((value) => Number.isSafeInteger(value) && value > 0));
    if (!known.has(sourceVersion)) fail("backup_schema_incompatible", 409, "Backup schema version is not known by this portal");
    return [...known].filter((version) => version > sourceVersion && version <= schema.currentVersion).sort((a, b) => a - b);
  }
  return Array.from({ length: schema.currentVersion - sourceVersion }, (_, index) => sourceVersion + index + 1);
}

function normalizedPreviewFailure(error: unknown): BackupImportPreviewError {
  if (error instanceof BackupImportPreviewError) return error;
  if (plainObject(error) && error.code === "backup_schema_incompatible") {
    return new BackupImportPreviewError("backup_schema_incompatible", 409, "Backup schema is incompatible");
  }
  return new BackupImportPreviewError("backup_preview_failed", 500, "Backup preview failed");
}

export async function previewBackupImport(
  env: BackupExportEnv,
  document: BackupImportDocument,
  schema: BackupPreviewSchema,
  registry: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>,
): Promise<BackupImportPreviewResult> {
  if (!env.DB) fail("backup_database_unavailable", 503, "Backup database is unavailable");
  if (schema.state !== "ready" || !Number.isSafeInteger(schema.currentVersion) || schema.currentVersion < 1) {
    fail("backup_schema_incompatible", 409, "Current portal schema is incompatible");
  }
  if (document.manifest.schemaVersion > schema.currentVersion) {
    fail("backup_schema_incompatible", 409, "Backup schema is newer than the current portal schema");
  }

  const migrations = requiredMigrations(document.manifest.schemaVersion, schema);
  const domains: BackupDomainPreview[] = [];

  try {
    for (const domain of document.manifest.domains) {
      const exporter = registry.get(domain);
      const expectedPath = `domains/${domain}.json`;
      if (!exporter || exporter.domain !== domain || exporter.path !== expectedPath) {
        fail("backup_schema_incompatible", 409, `Backup domain is unavailable: ${domain}`);
      }
      const incoming = payloadRecords(document.payloads[expectedPath], "backup_payload_invalid");
      const currentPayload = await exporter.export(env);
      assertSanitizedBackupPayload(currentPayload.payload);
      const current = payloadRecords(currentPayload.payload, "backup_schema_incompatible");
      if (currentPayload.records !== current.length) {
        fail("backup_schema_incompatible", 409, `Current ${domain} record count is inconsistent`);
      }
      domains.push(compareDomain(domain, incoming, current));
    }
  } catch (error) {
    throw normalizedPreviewFailure(error);
  }

  const summary = domains.reduce((total, domain) => ({
    add: total.add + domain.add,
    update: total.update + domain.update,
    unchanged: total.unchanged + domain.unchanged,
    conflict: total.conflict + domain.conflict,
    removeIgnored: total.removeIgnored + domain.removeIgnored,
  }), emptySummary());

  return {
    backup: {
      format: document.manifest.format,
      version: document.manifest.version,
      createdAt: document.manifest.createdAt,
      sourceSchemaVersion: document.manifest.schemaVersion,
      currentSchemaVersion: schema.currentVersion,
    },
    selectedDomains: [...document.manifest.domains],
    requiredMigrations: migrations,
    canRestore: migrations.length === 0 && summary.conflict === 0,
    summary,
    domains,
  };
}
