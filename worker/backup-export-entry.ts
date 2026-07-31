import { appendAuditEvent, type AuditContext, type AuditEventInput } from "../audit-log.ts";
import {
  BackupExportError,
  exportSanitizedBackup,
  parseBackupExportRequest,
  type BackupExportEnv,
  type PortalBackupDomainExporter,
} from "../backup-export.ts";
import { SANITIZED_BACKUP_EXPORTERS } from "../backup-export-domains.ts";
import type { PortalBackupDomain } from "../backup-manifest.ts";

const MAX_BACKUP_EXPORT_REQUEST_BYTES = 4_096;
const PORTAL_BACKUP_SCHEMA_VERSION = 1;

type BackupExportAudit = (
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
) => Promise<unknown>;

export type BackupExportRouteDependencies = {
  registry?: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>;
  appendAudit?: BackupExportAudit;
  now?: () => number;
};

function responseHeaders(createdAt: string): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="portal-backup-${createdAt.slice(0, 10)}.json"`,
  };
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function auditSafe(
  audit: BackupExportAudit,
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
): Promise<void> {
  await audit(env, context, event).catch(() => null);
}

export async function handleBackupExportRequest(
  request: Request,
  env: BackupExportEnv,
  auditContext: AuditContext,
  dependencies: BackupExportRouteDependencies = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(405, "backup_method_not_allowed", "Method not allowed");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BACKUP_EXPORT_REQUEST_BYTES) {
    return errorResponse(413, "backup_request_too_large", "Backup export request is too large");
  }

  const startedAt = dependencies.now?.() ?? Date.now();
  const audit = dependencies.appendAudit ?? appendAuditEvent;
  let domains: PortalBackupDomain[] = [];

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_EXPORT_REQUEST_BYTES) {
      throw new BackupExportError("backup_request_too_large", 413, "Backup export request is too large");
    }

    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new BackupExportError("backup_request_invalid", 400, "Backup export request must contain valid JSON");
    }

    const parsed = parseBackupExportRequest(input);
    domains = parsed.domains;
    const document = await exportSanitizedBackup(
      env,
      { domains, schemaVersion: PORTAL_BACKUP_SCHEMA_VERSION },
      dependencies.registry ?? SANITIZED_BACKUP_EXPORTERS,
    );

    await auditSafe(audit, env, auditContext, {
      action: "backup.export.completed",
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

    return new Response(JSON.stringify(document), {
      status: 200,
      headers: responseHeaders(document.manifest.createdAt),
    });
  } catch (error) {
    const normalized = error instanceof BackupExportError
      ? error
      : new BackupExportError("backup_export_failed", 500, "Backup export failed");

    await auditSafe(audit, env, auditContext, {
      action: "backup.export.failed",
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
