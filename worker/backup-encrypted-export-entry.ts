import { appendAuditEvent, type AuditContext, type AuditEventInput } from "../audit-log.ts";
import {
  BackupEncryptedExportError,
  exportEncryptedBackup,
  parseEncryptedBackupExportRequest,
  type EncryptedBackupDocument,
} from "../src/backup/export/backup-encrypted-export.ts";
import { FULL_BACKUP_EXPORTERS, type FullBackupDomainExporter } from "../src/backup/export/backup-full-domains.ts";
import type { PortalBackupDomain } from "../src/backup/backup-manifest.ts";
import type { BackupExportEnv } from "../src/backup/export/backup-export.ts";
import { inspectPortalSchema, type PortalSchemaStatus } from "../db/portal-migrations.ts";

const MAX_ENCRYPTED_EXPORT_REQUEST_BYTES = 16 * 1024;

type BackupEncryptedExportAudit = (
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
) => Promise<unknown>;

type BackupEncryptedExportSchemaInspector = (
  env: BackupExportEnv,
) => Promise<Pick<PortalSchemaStatus, "state" | "currentVersion">>;

type BackupEncryptedExporter = (
  env: BackupExportEnv,
  options: Parameters<typeof exportEncryptedBackup>[1],
  registry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>,
) => Promise<EncryptedBackupDocument>;

export type BackupEncryptedExportRouteDependencies = {
  registry?: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>;
  appendAudit?: BackupEncryptedExportAudit;
  inspectSchema?: BackupEncryptedExportSchemaInspector;
  exportBackup?: BackupEncryptedExporter;
  now?: () => number;
};

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function responseHeaders(createdAt: string): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="portal-full-backup-${createdAt.slice(0, 10)}.json"`,
  };
}

async function auditSafe(
  audit: BackupEncryptedExportAudit,
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
): Promise<void> {
  await audit(env, context, event).catch(() => null);
}

const safeErrors = new Map<string, { status: number; message: string }>([
  ["backup_request_too_large", { status: 413, message: "Encrypted backup export request is too large" }],
  ["backup_request_invalid", { status: 400, message: "Encrypted backup export request is invalid" }],
  ["backup_database_unavailable", { status: 503, message: "Backup database is unavailable" }],
  ["backup_schema_incompatible", { status: 409, message: "Backup schema is incompatible" }],
  ["backup_password_invalid", { status: 400, message: "Backup password is invalid" }],
  ["backup_encryption_unsupported", { status: 422, message: "Backup encryption parameters are unsupported" }],
  ["backup_encryption_failed", { status: 500, message: "Backup encryption failed" }],
  ["backup_payload_too_large", { status: 413, message: "Backup payload is too large" }],
  ["backup_document_too_large", { status: 413, message: "Encrypted backup document is too large" }],
  ["backup_encrypted_export_failed", { status: 500, message: "Encrypted backup export failed" }],
]);

function normalizeError(error: unknown): BackupEncryptedExportError {
  const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";
  const safe = safeErrors.get(code);
  if (safe) return new BackupEncryptedExportError(code, safe.status, safe.message);
  return new BackupEncryptedExportError("backup_encrypted_export_failed", 500, "Encrypted backup export failed");
}

export async function handleEncryptedBackupExportRequest(
  request: Request,
  env: BackupExportEnv,
  auditContext: AuditContext,
  dependencies: BackupEncryptedExportRouteDependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return errorResponse(405, "backup_method_not_allowed", "Method not allowed");

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ENCRYPTED_EXPORT_REQUEST_BYTES) {
    return errorResponse(413, "backup_request_too_large", "Encrypted backup export request is too large");
  }

  const startedAt = dependencies.now?.() ?? Date.now();
  const audit = dependencies.appendAudit ?? appendAuditEvent;
  let domains: PortalBackupDomain[] = [];

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_ENCRYPTED_EXPORT_REQUEST_BYTES) {
      throw new BackupEncryptedExportError("backup_request_too_large", 413, "Encrypted backup export request is too large");
    }

    let input: unknown;
    try { input = JSON.parse(text); } catch {
      throw new BackupEncryptedExportError("backup_request_invalid", 400, "Encrypted backup export request must contain valid JSON");
    }
    const parsed = parseEncryptedBackupExportRequest(input);
    domains = parsed.domains;
    if (!env.DB) throw new BackupEncryptedExportError("backup_database_unavailable", 503, "Backup database is unavailable");

    const schema = await (dependencies.inspectSchema ?? inspectPortalSchema)(env);
    if (schema.state !== "ready" || !Number.isSafeInteger(schema.currentVersion) || schema.currentVersion < 1) {
      throw new BackupEncryptedExportError("backup_schema_incompatible", 409, "Backup schema is incompatible");
    }

    const document = await (dependencies.exportBackup ?? exportEncryptedBackup)(
      env,
      { domains, password: parsed.password, schemaVersion: schema.currentVersion },
      dependencies.registry ?? FULL_BACKUP_EXPORTERS,
    );

    await auditSafe(audit, env, auditContext, {
      action: "backup.encrypted.export.completed",
      resourceType: "portal-backup",
      outcome: "success",
      schemaVersion: String(document.manifest.schemaVersion),
      metadata: {
        domains,
        entries: document.summary.entries,
        records: document.summary.records,
        bytes: document.summary.bytes,
        version: document.manifest.version,
        durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
      },
    });

    return new Response(JSON.stringify(document), { status: 200, headers: responseHeaders(document.manifest.createdAt) });
  } catch (error) {
    const normalized = normalizeError(error);
    await auditSafe(audit, env, auditContext, {
      action: "backup.encrypted.export.failed",
      resourceType: "portal-backup",
      outcome: "failure",
      errorCode: normalized.code,
      metadata: {
        domains,
        durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
      },
    });
    return errorResponse(normalized.status, normalized.code, normalized.message);
  }
}
