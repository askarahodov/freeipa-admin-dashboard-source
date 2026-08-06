import {
  appendAuditEvent,
  createAuditContext,
  type AuditContext,
  type AuditEventInput,
} from "../audit-log.ts";
import {
  STORAGE_MIGRATION_PREFLIGHT_PATH,
  type StorageMigrationPreflightReport,
} from "../storage-migration-preflight-contract.ts";
import {
  inspectStorageMigrationPreflight,
  unavailableStorageMigrationPreflightReport,
} from "../storage-migration-preflight.ts";
import { encryptedBackupAccess } from "./backup-encrypted-root-entry.ts";

const MAX_REQUEST_BYTES = 1024;

type PreflightEnv = {
  DB?: D1Database;
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};
type StorageAccess = { role: string; identity: string; groups: string[] };
type Dependencies = {
  access?: (request: Request, env: PreflightEnv) => StorageAccess;
  createContext?: (access: StorageAccess) => AuditContext;
  inspect?: typeof inspectStorageMigrationPreflight;
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

function bounded(value: unknown, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(Math.trunc(parsed), maximum)) : 0;
}

function auditEvent(report: StorageMigrationPreflightReport, durationMs: number): AuditEventInput {
  const unavailable = report.state === "unavailable";
  return {
    action: "storage.migration.preflight",
    resourceType: "portal-storage",
    outcome: unavailable ? "failure" : "success",
    ...(unavailable ? { errorCode: "migration_preflight_unavailable" } : {}),
    metadata: {
      state: report.state,
      decision: report.decision,
      code: report.code,
      durationMs: bounded(durationMs, 60_000),
      currentVersion: report.schema.currentVersion,
      latestVersion: report.schema.latestVersion,
      appliedCount: bounded(report.journal.appliedCount, 10_000),
      pendingCount: bounded(report.journal.pendingCount, 10_000),
      schemaCode: report.schema.code,
      journalCode: report.journal.code,
      integrityCode: report.integrity.code,
      backupCode: report.backup.code,
      lockCode: report.lock.code,
      backupAgeMs: report.backup.ageMs === null ? null : bounded(report.backup.ageMs, 604_800_000),
      lockAgeMs: report.lock.ageMs === null ? null : bounded(report.lock.ageMs, 604_800_000),
    },
  };
}

function plainEmptyObject(value: unknown): boolean {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === 0;
}

async function boundedBodyText(request: Request): Promise<{ state: "ok"; text: string } | { state: "invalid" | "too_large" }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return { state: "too_large" };
  if (!request.body) return { state: "invalid" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        return { state: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { state: "ok", text };
  } catch {
    return { state: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

async function validateBody(request: Request): Promise<"ok" | "invalid" | "too_large"> {
  const body = await boundedBodyText(request);
  if (body.state !== "ok") return body.state;
  try {
    return plainEmptyObject(JSON.parse(body.text)) ? "ok" : "invalid";
  } catch {
    return "invalid";
  }
}

export async function handleStorageMigrationPreflightRequest(
  request: Request,
  env: PreflightEnv,
  dependencies: Dependencies = {},
): Promise<Response | null> {
  if (new URL(request.url).pathname !== STORAGE_MIGRATION_PREFLIGHT_PATH) return null;
  if (request.method !== "POST") {
    return json(
      { ok: false, code: "migration_preflight_method_not_allowed" },
      405,
      undefined,
      { allow: "POST" },
    );
  }

  const access = dependencies.access
    ? dependencies.access(request, env)
    : encryptedBackupAccess(request, env);
  if (access.role !== "admin") {
    return json({
      ok: false,
      code: "migration_preflight_forbidden",
      requiredRole: "admin",
      role: access.role,
    }, 403);
  }

  const bodyState = await validateBody(request);
  if (bodyState === "too_large") {
    return json({ ok: false, code: "migration_preflight_request_too_large" }, 413);
  }
  if (bodyState === "invalid") {
    return json({ ok: false, code: "migration_preflight_request_invalid" }, 400);
  }

  const context = (dependencies.createContext ?? createAuditContext)(access);
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const appendAudit = dependencies.appendAudit ?? appendAuditEvent;

  try {
    const report = await (dependencies.inspect ?? inspectStorageMigrationPreflight)(env);
    const durationMs = bounded(now() - startedAt, 60_000);
    try {
      await appendAudit(env, context, auditEvent(report, durationMs));
    } catch {
      // Diagnostic response remains available when append-only audit persistence is degraded.
    }
    return json(
      { ...report, correlationId: context.correlationId },
      report.state === "unavailable" ? 503 : 200,
      context.correlationId,
    );
  } catch {
    const generatedAt = now();
    const durationMs = bounded(generatedAt - startedAt, 60_000);
    const report = unavailableStorageMigrationPreflightReport(generatedAt, durationMs);
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
