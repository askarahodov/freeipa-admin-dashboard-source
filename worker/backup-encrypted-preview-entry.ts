import { appendAuditEvent, type AuditContext, type AuditEventInput } from "../audit-log.ts";
import {
  BackupEncryptedPreviewError,
  previewEncryptedBackupImport,
} from "../backup-encrypted-preview.ts";
import { SANITIZED_BACKUP_EXPORTERS } from "../backup-export-domains.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "../backup-export.ts";
import { PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "../backup-manifest.ts";
import { inspectPortalSchema, type PortalSchemaStatus } from "../db/portal-migrations.ts";

const MAX_ENCRYPTED_PREVIEW_REQUEST_BYTES = 20 * 1024 * 1024;

type BackupEncryptedPreviewAudit = (env: BackupExportEnv, context: AuditContext, event: AuditEventInput) => Promise<unknown>;
type BackupEncryptedPreviewSchemaInspector = (env: BackupExportEnv) => Promise<Pick<PortalSchemaStatus, "state" | "currentVersion" | "latestVersion" | "appliedVersions">>;
type BackupEncryptedPreviewer = typeof previewEncryptedBackupImport;

export type BackupEncryptedPreviewRouteDependencies = {
  registry?: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>;
  appendAudit?: BackupEncryptedPreviewAudit;
  inspectSchema?: BackupEncryptedPreviewSchemaInspector;
  previewBackup?: BackupEncryptedPreviewer;
  now?: () => number;
};

function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: message, code }), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
async function auditSafe(audit: BackupEncryptedPreviewAudit, env: BackupExportEnv, context: AuditContext, event: AuditEventInput): Promise<void> { await audit(env, context, event).catch(() => null); }

const safeErrors = new Map<string, { status: number; message: string }>([
  ["backup_request_too_large", { status: 413, message: "Encrypted backup preview request is too large" }],
  ["backup_request_invalid", { status: 400, message: "Encrypted backup preview request is invalid" }],
  ["backup_database_unavailable", { status: 503, message: "Backup database is unavailable" }],
  ["backup_schema_incompatible", { status: 409, message: "Backup schema is incompatible" }],
  ["backup_mode_unsupported", { status: 422, message: "Encrypted backup mode is required" }],
  ["backup_payload_missing", { status: 422, message: "Encrypted backup payload is missing" }],
  ["backup_payload_unexpected", { status: 422, message: "Encrypted backup contains an unexpected payload" }],
  ["backup_corrupted", { status: 422, message: "Encrypted backup is corrupted" }],
  ["backup_decryption_failed", { status: 422, message: "Backup decryption failed" }],
  ["backup_full_payload_invalid", { status: 422, message: "Encrypted backup payload is invalid" }],
  ["backup_document_too_large", { status: 413, message: "Encrypted backup document is too large" }],
]);

function normalizeError(error: unknown): BackupEncryptedPreviewError {
  if (error instanceof BackupEncryptedPreviewError) {
    const safe = safeErrors.get(error.code);
    return safe ? new BackupEncryptedPreviewError(error.code, safe.status, safe.message) : new BackupEncryptedPreviewError("backup_encrypted_preview_failed", 500, "Encrypted backup preview failed");
  }
  if (error && typeof error === "object") {
    const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
    const safe = safeErrors.get(code);
    if (safe) return new BackupEncryptedPreviewError(code, safe.status, safe.message);
  }
  return new BackupEncryptedPreviewError("backup_encrypted_preview_failed", 500, "Encrypted backup preview failed");
}

export async function handleEncryptedBackupPreviewRequest(request: Request, env: BackupExportEnv, auditContext: AuditContext, dependencies: BackupEncryptedPreviewRouteDependencies = {}): Promise<Response> {
  if (request.method !== "POST") return errorResponse(405, "backup_method_not_allowed", "Method not allowed");
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ENCRYPTED_PREVIEW_REQUEST_BYTES) return errorResponse(413, "backup_request_too_large", "Encrypted backup preview request is too large");

  const startedAt = dependencies.now?.() ?? Date.now();
  const audit = dependencies.appendAudit ?? appendAuditEvent;
  let domains: PortalBackupDomain[] = [];
  let encryptedBytes = 0;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_ENCRYPTED_PREVIEW_REQUEST_BYTES) throw new BackupEncryptedPreviewError("backup_request_too_large", 413, "Encrypted backup preview request is too large");
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new BackupEncryptedPreviewError("backup_request_invalid", 400, "Encrypted backup preview request must contain valid JSON"); }
    if (!plainObject(input) || Object.keys(input).some((key) => key !== "document" && key !== "password") || !Object.hasOwn(input, "document") || !Object.hasOwn(input, "password")) throw new BackupEncryptedPreviewError("backup_request_invalid", 400, "Encrypted backup preview request contains invalid fields");

    const rawDocument = input.document;
    if (plainObject(rawDocument) && plainObject(rawDocument.manifest) && Array.isArray(rawDocument.manifest.domains)) domains = PORTAL_BACKUP_DOMAINS.filter((domain) => rawDocument.manifest.domains.includes(domain));
    if (plainObject(rawDocument) && plainObject(rawDocument.summary) && Number.isSafeInteger(rawDocument.summary.bytes)) encryptedBytes = Number(rawDocument.summary.bytes);
    if (!env.DB) throw new BackupEncryptedPreviewError("backup_database_unavailable", 503, "Backup database is unavailable");
    const schema = await (dependencies.inspectSchema ?? inspectPortalSchema)(env);
    if (schema.state !== "ready" || !Number.isSafeInteger(schema.currentVersion) || schema.currentVersion < 1) throw new BackupEncryptedPreviewError("backup_schema_incompatible", 409, "Backup schema is incompatible");

    const result = await (dependencies.previewBackup ?? previewEncryptedBackupImport)(env, rawDocument, input.password, schema, dependencies.registry ?? SANITIZED_BACKUP_EXPORTERS);
    domains = result.selectedDomains;
    await auditSafe(audit, env, auditContext, {
      action: "backup.encrypted.preview.completed",
      resourceType: "portal-backup",
      outcome: "success",
      schemaVersion: String(result.backup.currentSchemaVersion),
      metadata: { domains, sourceSchemaVersion: result.backup.sourceSchemaVersion, currentSchemaVersion: result.backup.currentSchemaVersion, requiredMigrations: result.requiredMigrations, counts: result.summary, canRestore: result.canRestore, encryptedBytes, durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt) },
    });
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    const normalized = normalizeError(error);
    await auditSafe(audit, env, auditContext, {
      action: "backup.encrypted.preview.failed",
      resourceType: "portal-backup",
      outcome: "failure",
      errorCode: normalized.code,
      metadata: { domains, encryptedBytes, durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt) },
    });
    return errorResponse(normalized.status, normalized.code, normalized.message);
  }
}
