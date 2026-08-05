import {
  appendAuditEvent,
  createAuditContext,
  type AuditContext,
  type AuditEventInput,
} from "../audit-log.ts";
import { STORAGE_STATUS_PATH } from "../storage-status-contract.ts";
import {
  inspectStorageStatus,
  type StorageStatusReport,
} from "../storage-status.ts";
import { encryptedBackupAccess } from "./backup-encrypted-root-entry.ts";

type StorageStatusEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};

type StorageAccess = {
  role: string;
  identity: string;
  groups: string[];
};

type StorageStatusDependencies = {
  access?: (request: Request, env: StorageStatusEnv) => StorageAccess;
  createContext?: (access: StorageAccess) => AuditContext;
  inspect?: typeof inspectStorageStatus;
  appendAudit?: typeof appendAuditEvent;
  now?: () => number;
};

function json(
  value: unknown,
  status: number,
  correlationId?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  if (correlationId) headers.set("x-correlation-id", correlationId);
  return new Response(JSON.stringify(value), { status, headers });
}

function boundedDuration(startedAt: number, finishedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, Math.min(Math.trunc(finishedAt - startedAt), 60_000));
}

function auditCodes(report: StorageStatusReport): string[] {
  return [report.database.code, report.encryption.code, report.lifecycle.code]
    .filter((value): value is string => typeof value === "string" && /^[a-z0-9_.-]{1,80}$/.test(value))
    .slice(0, 8);
}

function auditEvent(report: StorageStatusReport, durationMs: number): AuditEventInput {
  const unavailable = report.state === "unavailable";
  return {
    action: "storage.inspect",
    resourceType: "portal-storage",
    outcome: unavailable ? "failure" : "success",
    ...(unavailable ? { errorCode: "storage_status_unavailable" } : {}),
    metadata: {
      state: report.state,
      schemaVersion: report.schema.currentVersion,
      domainCount: report.domains.length,
      durationMs,
      codes: auditCodes(report),
    },
  };
}

function unexpectedFailurePayload(generatedAt: number, correlationId: string) {
  return {
    contractVersion: "1",
    generatedAt,
    state: "unavailable",
    code: "storage_status_unavailable",
    correlationId,
  } as const;
}

export async function handleStorageStatusRequest(
  request: Request,
  env: StorageStatusEnv,
  dependencies: StorageStatusDependencies = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== STORAGE_STATUS_PATH) return null;
  if (request.method !== "GET") {
    return json(
      { ok: false, code: "storage_status_method_not_allowed" },
      405,
      undefined,
      { allow: "GET" },
    );
  }

  const currentAccess = dependencies.access
    ? dependencies.access(request, env)
    : encryptedBackupAccess(request, env);
  if (currentAccess.role !== "admin") {
    return json({
      ok: false,
      code: "storage_status_forbidden",
      requiredRole: "admin",
      role: currentAccess.role,
    }, 403);
  }

  const context = (dependencies.createContext ?? createAuditContext)(currentAccess);
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const appendAudit = dependencies.appendAudit ?? appendAuditEvent;

  try {
    const report = await (dependencies.inspect ?? inspectStorageStatus)(env);
    const durationMs = boundedDuration(startedAt, now());
    try {
      await appendAudit(env, context, auditEvent(report, durationMs));
    } catch {
      // Storage status remains available even when append-only audit persistence is degraded.
    }
    return json(
      { ...report, correlationId: context.correlationId },
      report.state === "unavailable" ? 503 : 200,
      context.correlationId,
    );
  } catch {
    const generatedAt = now();
    const durationMs = boundedDuration(startedAt, generatedAt);
    try {
      await appendAudit(env, context, {
        action: "storage.inspect",
        resourceType: "portal-storage",
        outcome: "failure",
        errorCode: "storage_status_unavailable",
        metadata: {
          state: "unavailable",
          schemaVersion: null,
          domainCount: 0,
          durationMs,
          codes: ["storage_status_unavailable"],
        },
      });
    } catch {
      // Never replace the fixed safe response with an audit persistence failure.
    }
    return json(
      unexpectedFailurePayload(generatedAt, context.correlationId),
      503,
      context.correlationId,
    );
  }
}
