import {
  appendAuditEvent,
  createAuditContext,
  type AuditContext,
  type AuditEventInput,
} from "../audit-log.ts";
import {
  STORAGE_INTEGRITY_PATH,
  type StorageIntegrityReport,
} from "../storage-integrity-contract.ts";
import {
  inspectStorageIntegrity,
  unavailableStorageIntegrityReport,
} from "../storage-integrity.ts";
import { encryptedBackupAccess } from "./backup-encrypted-root-entry.ts";

type StorageIntegrityEnv = {
  DB?: D1Database;
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

type StorageIntegrityDependencies = {
  access?: (request: Request, env: StorageIntegrityEnv) => StorageAccess;
  createContext?: (access: StorageAccess) => AuditContext;
  inspect?: typeof inspectStorageIntegrity;
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

function boundedCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), 10_000));
}

function auditEvent(report: StorageIntegrityReport, durationMs: number): AuditEventInput {
  const unavailable = report.state === "unavailable";
  return {
    action: "storage.integrity.check",
    resourceType: "portal-storage",
    outcome: unavailable ? "failure" : "success",
    ...(unavailable ? { errorCode: "storage_integrity_unavailable" } : {}),
    metadata: {
      state: report.state,
      durationMs,
      quickCheckCode: report.quickCheck.code,
      indexCode: report.indexes.code,
      expected: boundedCount(report.indexes.expected),
      present: boundedCount(report.indexes.present),
      missing: boundedCount(report.indexes.missing),
      mismatched: boundedCount(report.indexes.mismatched),
      unexpected: boundedCount(report.indexes.unexpected),
    },
  };
}

export async function handleStorageIntegrityRequest(
  request: Request,
  env: StorageIntegrityEnv,
  dependencies: StorageIntegrityDependencies = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== STORAGE_INTEGRITY_PATH) return null;
  if (request.method !== "POST") {
    return json(
      { ok: false, code: "storage_integrity_method_not_allowed" },
      405,
      undefined,
      { allow: "POST" },
    );
  }

  const currentAccess = dependencies.access
    ? dependencies.access(request, env)
    : encryptedBackupAccess(request, env);
  if (currentAccess.role !== "admin") {
    return json({
      ok: false,
      code: "storage_integrity_forbidden",
      requiredRole: "admin",
      role: currentAccess.role,
    }, 403);
  }

  const context = (dependencies.createContext ?? createAuditContext)(currentAccess);
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const appendAudit = dependencies.appendAudit ?? appendAuditEvent;

  try {
    const report = await (dependencies.inspect ?? inspectStorageIntegrity)(env);
    const durationMs = boundedDuration(startedAt, now());
    try {
      await appendAudit(env, context, auditEvent(report, durationMs));
    } catch {
      // Integrity diagnostics remain available when append-only audit persistence is degraded.
    }
    return json(
      { ...report, correlationId: context.correlationId },
      report.state === "unavailable" ? 503 : 200,
      context.correlationId,
    );
  } catch {
    const generatedAt = now();
    const durationMs = boundedDuration(startedAt, generatedAt);
    const report = unavailableStorageIntegrityReport(generatedAt, durationMs);
    try {
      await appendAudit(env, context, auditEvent(report, durationMs));
    } catch {
      // Never replace the fixed safe response with an audit persistence failure.
    }
    return json(
      { ...report, correlationId: context.correlationId },
      503,
      context.correlationId,
    );
  }
}
