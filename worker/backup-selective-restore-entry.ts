import { sameOriginAdminMutation } from "../src/auth/admin-session-authorization.ts";
import { appendAuditEvent, type AuditContext, type AuditEventInput } from "../audit-log.ts";
import {
  BackupRestoreStageError,
  hashRestoreStageSecret,
} from "../src/backup/restore/backup-restore-stage.ts";
import {
  BackupRestoreStageRepositoryError,
  cancelRestoreStage,
} from "../src/backup/restore/backup-restore-stage-repository.ts";
import {
  BackupSelectiveRestoreCommitError,
  commitSelectiveProductionRestore,
} from "../src/backup/restore/backup-selective-restore-commit.ts";
import {
  BackupSelectiveRestorePrepareError,
  prepareSelectiveProductionRestore,
} from "../src/backup/restore/backup-selective-restore-prepare.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "../src/backup/export/backup-export.ts";
import { SANITIZED_BACKUP_EXPORTERS } from "../src/backup/export/backup-export-domains.ts";
import {
  FULL_BACKUP_EXPORTERS,
  type FullBackupDomainExporter,
} from "../src/backup/export/backup-full-domains.ts";
import { PORTAL_BACKUP_DOMAINS, type PortalBackupDomain } from "../src/backup/backup-manifest.ts";
import {
  inspectPortalSchema,
  type PortalSchemaStatus,
} from "../db/portal-migrations-hardened.ts";

export const SELECTIVE_RESTORE_PREPARE_PATH = "/api/admin/backups/import/encrypted/prepare-commit";
export const SELECTIVE_RESTORE_COMMIT_PATH = "/api/admin/backups/import/encrypted/commit";
export const SELECTIVE_RESTORE_CANCEL_PATH = "/api/admin/backups/import/encrypted/cancel";
export const MAX_SELECTIVE_RESTORE_REQUEST_BYTES = 42 * 1024 * 1024;
export const MAX_SELECTIVE_CANCEL_REQUEST_BYTES = 16 * 1024;

type SelectiveRestoreAudit = (
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
) => Promise<unknown>;
type SelectiveRestoreSchemaInspector = (
  env: BackupExportEnv,
) => Promise<Pick<PortalSchemaStatus, "state" | "currentVersion" | "latestVersion" | "appliedVersions">>;
type PrepareRunner = typeof prepareSelectiveProductionRestore;
type CommitRunner = typeof commitSelectiveProductionRestore;
type CancelRunner = typeof cancelRestoreStage;
type SecretHasher = typeof hashRestoreStageSecret;

export type SelectiveRestoreRouteDependencies = {
  sanitizedRegistry?: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>;
  fullRegistry?: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>;
  appendAudit?: SelectiveRestoreAudit;
  inspectSchema?: SelectiveRestoreSchemaInspector;
  prepareRestore?: PrepareRunner;
  commitRestore?: CommitRunner;
  cancelStage?: CancelRunner;
  hashSecret?: SecretHasher;
  now?: () => number;
};

class SelectiveRestoreRouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "SelectiveRestoreRouteError";
    this.code = code;
    this.status = status;
  }
}

const safeErrors = new Map<string, { status: number; message: string }>([
  ["backup_origin_forbidden", { status: 403, message: "Same-origin administrator request is required" }],
  ["backup_method_not_allowed", { status: 405, message: "Method not allowed" }],
  ["backup_request_too_large", { status: 413, message: "Backup restore request is too large" }],
  ["backup_request_invalid", { status: 400, message: "Backup restore request is invalid" }],
  ["backup_database_unavailable", { status: 503, message: "Backup database is unavailable" }],
  ["backup_schema_incompatible", { status: 409, message: "Backup schema is incompatible" }],
  ["backup_restore_dependency_invalid", { status: 422, message: "Backup restore domain dependencies are invalid" }],
  ["backup_restore_domain_unsupported", { status: 422, message: "Backup restore domain is unsupported" }],
  ["backup_restore_confirmation_required", { status: 422, message: "Backup restore confirmation is required" }],
  ["backup_restore_admin_required", { status: 422, message: "Restored local authentication requires an active administrator" }],
  ["backup_restore_stage_invalid", { status: 409, message: "Backup restore stage is invalid" }],
  ["backup_restore_stage_expired", { status: 409, message: "Backup restore stage expired" }],
  ["backup_restore_stage_cancelled", { status: 409, message: "Backup restore stage was cancelled" }],
  ["backup_restore_stage_committed", { status: 409, message: "Backup restore stage was already committed" }],
  ["backup_restore_stale", { status: 409, message: "Backup restore preview is stale" }],
  ["backup_recovery_point_invalid", { status: 422, message: "Backup recovery point is invalid" }],
  ["backup_recovery_point_stale", { status: 409, message: "Backup recovery point is stale" }],
  ["backup_restore_commit_failed", { status: 500, message: "Backup restore commit failed" }],
]);

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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function auditSafe(
  audit: SelectiveRestoreAudit,
  env: BackupExportEnv,
  context: AuditContext,
  event: AuditEventInput,
): Promise<void> {
  await audit(env, context, event).catch(() => null);
}

function auditDomains(value: unknown): PortalBackupDomain[] {
  if (!Array.isArray(value)) return [];
  return PORTAL_BACKUP_DOMAINS.filter((domain) => value.includes(domain));
}

function normalizeError(error: unknown): SelectiveRestoreRouteError {
  if (error instanceof SelectiveRestoreRouteError) return error;
  if (error instanceof BackupSelectiveRestorePrepareError
      || error instanceof BackupSelectiveRestoreCommitError
      || error instanceof BackupRestoreStageError
      || error instanceof BackupRestoreStageRepositoryError) {
    const safe = safeErrors.get(error.code);
    if (safe) return new SelectiveRestoreRouteError(error.code, safe.status, safe.message);
  }
  if (plainObject(error) && typeof error.code === "string") {
    const safe = safeErrors.get(error.code);
    if (safe) return new SelectiveRestoreRouteError(error.code, safe.status, safe.message);
  }
  return new SelectiveRestoreRouteError(
    "backup_restore_commit_failed",
    500,
    "Backup restore request failed",
  );
}

function bodyLimit(pathname: string): number {
  return pathname === SELECTIVE_RESTORE_CANCEL_PATH
    ? MAX_SELECTIVE_CANCEL_REQUEST_BYTES
    : MAX_SELECTIVE_RESTORE_REQUEST_BYTES;
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw new SelectiveRestoreRouteError(
      "backup_request_too_large",
      413,
      "Backup restore request is too large",
    );
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) {
    throw new SelectiveRestoreRouteError(
      "backup_request_too_large",
      413,
      "Backup restore request is too large",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SelectiveRestoreRouteError(
      "backup_request_invalid",
      400,
      "Backup restore request must contain valid JSON",
    );
  }
}

function cancelInput(value: unknown): { stageId: string; secretValue: string } {
  if (!plainObject(value)
      || Object.keys(value).length !== 2
      || !Object.hasOwn(value, "stageId")
      || !Object.hasOwn(value, "stageSecret")
      || typeof value.stageId !== "string"
      || typeof value.stageSecret !== "string") {
    throw new SelectiveRestoreRouteError(
      "backup_request_invalid",
      400,
      "Backup restore cancel request is invalid",
    );
  }
  return { stageId: value.stageId, secretValue: value.stageSecret };
}

function readySchema(
  value: Pick<PortalSchemaStatus, "state" | "currentVersion" | "latestVersion" | "appliedVersions">,
): asserts value is Pick<PortalSchemaStatus, "state" | "currentVersion" | "latestVersion" | "appliedVersions"> & {
  state: "ready";
  currentVersion: number;
} {
  if (value.state !== "ready"
      || !Number.isSafeInteger(value.currentVersion)
      || value.currentVersion < 1) {
    throw new SelectiveRestoreRouteError(
      "backup_schema_incompatible",
      409,
      "Backup schema is incompatible",
    );
  }
}

function failureAction(pathname: string): string {
  if (pathname === SELECTIVE_RESTORE_PREPARE_PATH) return "backup.selective.prepare.failed";
  if (pathname === SELECTIVE_RESTORE_CANCEL_PATH) return "backup.selective.cancel.failed";
  return "backup.selective.commit.failed";
}

export async function handleSelectiveBackupRestoreRequest(
  request: Request,
  env: BackupExportEnv,
  auditContext: AuditContext,
  dependencies: SelectiveRestoreRouteDependencies = {},
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (![SELECTIVE_RESTORE_PREPARE_PATH, SELECTIVE_RESTORE_COMMIT_PATH, SELECTIVE_RESTORE_CANCEL_PATH].includes(pathname)) {
    return errorResponse(404, "backup_route_not_found", "Backup restore route was not found");
  }
  if (request.method !== "POST") {
    return errorResponse(405, "backup_method_not_allowed", "Method not allowed");
  }
  if (!sameOriginAdminMutation(request)) {
    return errorResponse(403, "backup_origin_forbidden", "Same-origin administrator request is required");
  }

  const startedAt = dependencies.now?.() ?? Date.now();
  const audit = dependencies.appendAudit ?? appendAuditEvent;
  let domains: PortalBackupDomain[] = [];
  let resourceId = "";
  try {
    const input = await readJson(request, bodyLimit(pathname));
    if (!env.DB) {
      throw new SelectiveRestoreRouteError(
        "backup_database_unavailable",
        503,
        "Backup database is unavailable",
      );
    }

    if (pathname === SELECTIVE_RESTORE_CANCEL_PATH) {
      const cancel = cancelInput(input);
      resourceId = cancel.stageId;
      const secretHash = await (dependencies.hashSecret ?? hashRestoreStageSecret)(cancel.secretValue);
      const result = await (dependencies.cancelStage ?? cancelRestoreStage)(env.DB, {
        id: cancel.stageId,
        actorIdentity: auditContext.actor.identity,
        stageSecretHash: secretHash,
        now: dependencies.now?.() ?? Date.now(),
      });
      await auditSafe(audit, env, auditContext, {
        action: "backup.selective.cancel.completed",
        resourceType: "portal-backup",
        resourceId: cancel.stageId,
        outcome: "success",
        metadata: {
          status: result.status,
          durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
        },
      });
      return jsonResponse({ ...result, stageId: cancel.stageId });
    }

    if (plainObject(input)) domains = auditDomains(input.domains);
    const schema = await (dependencies.inspectSchema ?? inspectPortalSchema)(env);
    readySchema(schema);
    const sanitized = dependencies.sanitizedRegistry ?? SANITIZED_BACKUP_EXPORTERS;
    const full = dependencies.fullRegistry ?? FULL_BACKUP_EXPORTERS;

    if (pathname === SELECTIVE_RESTORE_PREPARE_PATH) {
      const result = await (dependencies.prepareRestore ?? prepareSelectiveProductionRestore)(
        env,
        input,
        schema,
        auditContext.actor.identity,
        sanitized,
        full,
      );
      domains = result.selectedDomains;
      resourceId = result.stage.id;
      await auditSafe(audit, env, auditContext, {
        action: "backup.selective.prepare.completed",
        resourceType: "portal-backup",
        resourceId: result.stage.id,
        schemaVersion: String(result.currentSchemaVersion),
        outcome: "pending",
        metadata: {
          operation: result.operation,
          domains,
          sourceSchemaVersion: result.sourceSchemaVersion,
          currentSchemaVersion: result.currentSchemaVersion,
          expiresAt: result.stage.expiresAt,
          isolatedSummary: result.isolated.summary,
          recoverySummary: result.recovery.summary,
          durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
        },
      });
      return jsonResponse(result);
    }

    const result = await (dependencies.commitRestore ?? commitSelectiveProductionRestore)(
      env,
      input,
      schema,
      {
        identity: auditContext.actor.identity,
        groups: auditContext.actor.groups,
      },
      sanitized,
      full,
      { createCorrelationId: () => auditContext.correlationId },
    );
    return jsonResponse(result);
  } catch (error) {
    const normalized = normalizeError(error);
    await auditSafe(audit, env, auditContext, {
      action: failureAction(pathname),
      resourceType: "portal-backup",
      resourceId: resourceId || undefined,
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
