import { appendAuditEvent, type AuditContext, type AuditEventInput } from "../audit-log.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "../backup-export.ts";
import { SANITIZED_BACKUP_EXPORTERS } from "../backup-export-domains.ts";
import { FULL_BACKUP_EXPORTERS, type FullBackupDomainExporter } from "../backup-full-domains.ts";
import {
  BackupIsolatedRestoreError,
  testRestoreEncryptedBackupImport,
} from "../backup-isolated-restore.ts";
import { PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "../backup-manifest.ts";
import { inspectPortalSchema, type PortalSchemaStatus } from "../db/portal-migrations.ts";

const MAX_ISOLATED_RESTORE_REQUEST_BYTES = 20 * 1024 * 1024;

type IsolatedRestoreAudit = (
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
) => Promise<unknown>;
type IsolatedRestoreSchemaInspector = (
  env: BackupExportEnv,
) => Promise<Pick<PortalSchemaStatus, "state" | "currentVersion" | "latestVersion" | "appliedVersions">>;
type IsolatedRestoreRunner = typeof testRestoreEncryptedBackupImport;

export type IsolatedRestoreRouteDependencies = {
  sanitizedRegistry?: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>;
  fullRegistry?: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>;
  appendAudit?: IsolatedRestoreAudit;
  inspectSchema?: IsolatedRestoreSchemaInspector;
  testRestore?: IsolatedRestoreRunner;
  now?: () => number;
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function auditSafe(
  audit: IsolatedRestoreAudit,
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
): Promise<void> {
  await audit(env, context, event).catch(() => null);
}

const safeErrors = new Map<string, { status: number; message: string }>([
  ["backup_request_too_large", { status: 413, message: "Backup test restore request is too large" }],
  ["backup_request_invalid", { status: 400, message: "Backup test restore request is invalid" }],
  ["backup_database_unavailable", { status: 503, message: "Backup database is unavailable" }],
  ["backup_schema_incompatible", { status: 409, message: "Backup schema is incompatible" }],
  ["backup_mode_unsupported", { status: 422, message: "Encrypted backup mode is required" }],
  ["backup_payload_missing", { status: 422, message: "Encrypted backup payload is missing" }],
  ["backup_payload_unexpected", { status: 422, message: "Encrypted backup contains an unexpected payload" }],
  ["backup_corrupted", { status: 422, message: "Encrypted backup is corrupted" }],
  ["backup_decryption_failed", { status: 422, message: "Backup decryption failed" }],
  ["backup_full_payload_invalid", { status: 422, message: "Encrypted backup payload is invalid" }],
  ["backup_document_too_large", { status: 413, message: "Encrypted backup document is too large" }],
  ["backup_restore_stale", { status: 409, message: "Backup restore preview is stale" }],
  ["backup_test_restore_failed", { status: 500, message: "Backup test restore failed" }],
]);

function normalizeError(error: unknown): BackupIsolatedRestoreError {
  if (error instanceof BackupIsolatedRestoreError) {
    const safe = safeErrors.get(error.code);
    return safe
      ? new BackupIsolatedRestoreError(error.code, safe.status, safe.message)
      : new BackupIsolatedRestoreError("backup_test_restore_failed", 500, "Backup test restore failed");
  }
  if (plainObject(error) && typeof error.code === "string") {
    const safe = safeErrors.get(error.code);
    if (safe) return new BackupIsolatedRestoreError(error.code, safe.status, safe.message);
  }
  return new BackupIsolatedRestoreError("backup_test_restore_failed", 500, "Backup test restore failed");
}

function exactInput(value: unknown): value is Record<string, unknown> {
  return plainObject(value)
    && Object.keys(value).every((key) => ["document", "password", "domains", "approvalToken"].includes(key))
    && Object.hasOwn(value, "document")
    && Object.hasOwn(value, "password")
    && Object.hasOwn(value, "domains")
    && Object.hasOwn(value, "approvalToken")
    && typeof value.approvalToken === "string"
    && /^[0-9a-f]{64}$/.test(value.approvalToken);
}

function auditDomains(value: unknown): PortalBackupDomain[] {
  if (!Array.isArray(value)) return [];
  return PORTAL_BACKUP_DOMAINS.filter((domain) => value.includes(domain));
}

export async function handleIsolatedBackupRestoreRequest(
  request: Request,
  env: BackupExportEnv,
  auditContext: AuditContext,
  dependencies: IsolatedRestoreRouteDependencies = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(405, "backup_method_not_allowed", "Method not allowed");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ISOLATED_RESTORE_REQUEST_BYTES) {
    return errorResponse(413, "backup_request_too_large", "Backup test restore request is too large");
  }

  const startedAt = dependencies.now?.() ?? Date.now();
  const audit = dependencies.appendAudit ?? appendAuditEvent;
  let domains: PortalBackupDomain[] = [];
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_ISOLATED_RESTORE_REQUEST_BYTES) {
      throw new BackupIsolatedRestoreError(
        "backup_request_too_large",
        413,
        "Backup test restore request is too large",
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new BackupIsolatedRestoreError(
        "backup_request_invalid",
        400,
        "Backup test restore request must contain valid JSON",
      );
    }
    if (!exactInput(input)) {
      throw new BackupIsolatedRestoreError(
        "backup_request_invalid",
        400,
        "Backup test restore request contains invalid fields",
      );
    }
    domains = auditDomains(input.domains);
    if (!env.DB) {
      throw new BackupIsolatedRestoreError(
        "backup_database_unavailable",
        503,
        "Backup database is unavailable",
      );
    }
    const schema = await (dependencies.inspectSchema ?? inspectPortalSchema)(env);
    if (schema.state !== "ready"
        || !Number.isSafeInteger(schema.currentVersion)
        || schema.currentVersion < 1) {
      throw new BackupIsolatedRestoreError(
        "backup_schema_incompatible",
        409,
        "Backup schema is incompatible",
      );
    }

    const result = await (dependencies.testRestore ?? testRestoreEncryptedBackupImport)(
      env,
      input,
      schema,
      dependencies.sanitizedRegistry ?? SANITIZED_BACKUP_EXPORTERS,
      dependencies.fullRegistry ?? FULL_BACKUP_EXPORTERS,
    );
    domains = result.selectedDomains;
    await auditSafe(audit, env, auditContext, {
      action: "backup.encrypted.test-restore.completed",
      resourceType: "portal-backup",
      outcome: "success",
      schemaVersion: String(result.currentSchemaVersion),
      metadata: {
        domains,
        sourceSchemaVersion: result.sourceSchemaVersion,
        currentSchemaVersion: result.currentSchemaVersion,
        summary: result.summary,
        canCommit: result.canCommit,
        durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
      },
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const normalized = normalizeError(error);
    await auditSafe(audit, env, auditContext, {
      action: "backup.encrypted.test-restore.failed",
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