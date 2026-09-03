import { appendAuditEvent, type AuditContext, type AuditEventInput } from "../audit-log.ts";
import { SANITIZED_BACKUP_EXPORTERS } from "../src/backup/export/backup-export-domains.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "../src/backup/export/backup-export.ts";
import type { PortalBackupDomain } from "../src/backup/backup-manifest.ts";
import {
  BackupImportPreviewError,
  previewBackupImport,
  validateBackupImportDocument,
  type BackupPreviewSchema,
} from "../src/backup/preview/backup-import-preview.ts";
import { inspectPortalSchema, type PortalSchemaStatus } from "../db/portal-migrations.ts";

const MAX_BACKUP_IMPORT_PREVIEW_BYTES = 10 * 1024 * 1024;

type BackupPreviewAudit = (
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
) => Promise<unknown>;

type BackupPreviewSchemaInspector = (
  env: BackupExportEnv,
) => Promise<Pick<PortalSchemaStatus, "state" | "currentVersion" | "latestVersion" | "appliedVersions">>;

export type BackupImportPreviewRouteDependencies = {
  registry?: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>;
  appendAudit?: BackupPreviewAudit;
  inspectSchema?: BackupPreviewSchemaInspector;
  now?: () => number;
  maxBytes?: number;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function auditSafe(
  audit: BackupPreviewAudit,
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
): Promise<void> {
  await audit(env, context, event).catch(() => null);
}

function normalizedError(error: unknown): BackupImportPreviewError {
  if (error instanceof BackupImportPreviewError) return error;
  return new BackupImportPreviewError("backup_preview_failed", 500, "Backup preview failed");
}

function elapsed(now: (() => number) | undefined, startedAt: number): number {
  return Math.max(0, (now?.() ?? Date.now()) - startedAt);
}

export async function handleBackupImportPreviewRequest(
  request: Request,
  env: BackupExportEnv,
  auditContext: AuditContext,
  dependencies: BackupImportPreviewRouteDependencies = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed", code: "backup_method_not_allowed" }, 405);
  }

  const startedAt = dependencies.now?.() ?? Date.now();
  const audit = dependencies.appendAudit ?? appendAuditEvent;
  const maxBytes = dependencies.maxBytes ?? MAX_BACKUP_IMPORT_PREVIEW_BYTES;
  let domains: PortalBackupDomain[] = [];
  let sourceSchemaVersion: number | null = null;
  let currentSchemaVersion: number | null = null;

  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new BackupImportPreviewError("backup_request_too_large", 413, "Backup import preview request is too large");
    }

    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new BackupImportPreviewError("backup_request_too_large", 413, "Backup import preview request is too large");
    }

    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new BackupImportPreviewError("backup_request_invalid", 400, "Backup import preview request must contain valid JSON");
    }

    const document = await validateBackupImportDocument(input);
    domains = [...document.manifest.domains];
    sourceSchemaVersion = document.manifest.schemaVersion;

    if (!env.DB) {
      throw new BackupImportPreviewError("backup_database_unavailable", 503, "Backup database is unavailable");
    }

    let schema: BackupPreviewSchema;
    try {
      schema = await (dependencies.inspectSchema ?? inspectPortalSchema)(env);
    } catch {
      throw new BackupImportPreviewError("backup_schema_incompatible", 409, "Current portal schema is incompatible");
    }
    currentSchemaVersion = Number.isSafeInteger(schema.currentVersion) ? schema.currentVersion : null;

    const result = await previewBackupImport(
      env,
      document,
      schema,
      dependencies.registry ?? SANITIZED_BACKUP_EXPORTERS,
    );

    await auditSafe(audit, env, auditContext, {
      action: "backup.import.preview.completed",
      resourceType: "portal-backup",
      outcome: "success",
      schemaVersion: String(result.backup.currentSchemaVersion),
      metadata: {
        domains: result.selectedDomains,
        sourceSchemaVersion: result.backup.sourceSchemaVersion,
        currentSchemaVersion: result.backup.currentSchemaVersion,
        requiredMigrations: result.requiredMigrations,
        canRestore: result.canRestore,
        counts: result.summary,
        durationMs: elapsed(dependencies.now, startedAt),
      },
    });

    return jsonResponse(result, 200);
  } catch (error) {
    const normalized = normalizedError(error);
    await auditSafe(audit, env, auditContext, {
      action: "backup.import.preview.failed",
      resourceType: "portal-backup",
      outcome: "failure",
      errorCode: normalized.code,
      schemaVersion: currentSchemaVersion == null ? undefined : String(currentSchemaVersion),
      metadata: {
        domains,
        sourceSchemaVersion,
        currentSchemaVersion,
        durationMs: elapsed(dependencies.now, startedAt),
      },
    });
    return jsonResponse({ error: normalized.message, code: normalized.code }, normalized.status);
  }
}
