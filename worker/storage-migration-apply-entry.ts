import { createAuditContext, type AuditContext } from "../audit-log.ts";
import {
  STORAGE_MIGRATION_APPLY_PATH,
  STORAGE_MIGRATION_APPLY_STATUS_PATH,
  STORAGE_MIGRATION_RECONCILE_PATH,
  isStorageMigrationApplyPath,
  type StorageMigrationApplyInput,
} from "../src/storage/migration/apply/storage-migration-apply-contract.ts";
import {
  applyControlledStorageMigrations,
  inspectMigrationApplyStatus,
  reconcileControlledStorageMigration,
  type StorageMigrationApplyError,
} from "../src/storage/migration/apply/storage-migration-apply.ts";
import { sameOriginAdminMutation, serviceAdminTokenAuthorized } from "../admin-session-authorization.ts";
import { resolveLocalSession, type LocalAuthEnv } from "../local-auth.ts";
import { encryptedBackupAccess } from "./backup-encrypted-root-entry.ts";

const MAX_REQUEST_BYTES = 4096;
const maintenanceIdPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controllerSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const safeCodePattern = /^migration_(?:apply|reconcile|operation)_[a-z0-9_]{1,64}$/;
const safeStatuses = new Set([400, 401, 403, 405, 409, 413, 422, 500, 503]);

type ApplyEnv = LocalAuthEnv & {
  DB?: D1Database;
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  ADMIN_TOKEN?: string;
};
type ApplyAccess = { role: string; identity: string; groups: string[] };
type Dependencies = {
  authorize?: (request: Request, env: ApplyEnv) => Promise<ApplyAccess | null>;
  createContext?: (access: ApplyAccess) => AuditContext;
  apply?: typeof applyControlledStorageMigrations;
  status?: typeof inspectMigrationApplyStatus;
  reconcile?: typeof reconcileControlledStorageMigration;
};

function localMode(env: ApplyEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

async function authorizeAccess(request: Request, env: ApplyEnv): Promise<ApplyAccess | null> {
  if (await serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)) {
    return { role: "admin", identity: "service-admin@portal.local", groups: [] };
  }
  if (localMode(env)) {
    const session = await resolveLocalSession(env, request);
    if (!session) return null;
    if (session.role === "admin" && request.method !== "GET" && !sameOriginAdminMutation(request)) return null;
    return { role: session.role, identity: session.identity, groups: [] };
  }
  return encryptedBackupAccess(request, env);
}

function json(value: unknown, status: number, correlationId?: string, allow?: string): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  if (correlationId) headers.set("x-correlation-id", correlationId);
  if (allow) headers.set("allow", allow);
  return new Response(JSON.stringify(value), { status, headers });
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

function exactInput(value: unknown): StorageMigrationApplyInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(",") !== "confirmation,controllerSecret,maintenanceOperationId") return null;
  if (typeof source.maintenanceOperationId !== "string" || !maintenanceIdPattern.test(source.maintenanceOperationId)) return null;
  if (typeof source.controllerSecret !== "string" || !controllerSecretPattern.test(source.controllerSecret)) return null;
  if (typeof source.confirmation !== "string" || source.confirmation.length < 16 || source.confirmation.length > 180 || /[\r\n\0]/.test(source.confirmation)) return null;
  return {
    maintenanceOperationId: source.maintenanceOperationId,
    controllerSecret: source.controllerSecret,
    confirmation: source.confirmation,
  };
}

async function readInput(request: Request): Promise<{ state: "ok"; input: StorageMigrationApplyInput } | { state: "invalid" | "too_large" }> {
  const body = await boundedBodyText(request);
  if (body.state !== "ok") return body;
  try {
    const input = exactInput(JSON.parse(body.text));
    return input ? { state: "ok", input } : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

function safeFailure(error: unknown): { code: string; status: number } {
  const source = error && typeof error === "object"
    ? error as Partial<StorageMigrationApplyError>
    : {};
  const code = typeof source.code === "string" && safeCodePattern.test(source.code)
    ? source.code
    : "migration_apply_unavailable";
  const rawStatus = Number(source.status);
  const status = code === "migration_apply_unavailable"
    ? 503
    : Number.isSafeInteger(rawStatus) && safeStatuses.has(rawStatus) ? rawStatus : 503;
  return { code, status };
}

export async function handleStorageMigrationApplyRequest(
  request: Request,
  env: ApplyEnv,
  dependencies: Dependencies = {},
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!isStorageMigrationApplyPath(pathname)) return null;
  const expectedMethod = pathname === STORAGE_MIGRATION_APPLY_STATUS_PATH ? "GET" : "POST";
  if (request.method !== expectedMethod) {
    return json({ ok: false, code: "migration_apply_method_not_allowed" }, 405, undefined, expectedMethod);
  }

  const access = await (dependencies.authorize ?? authorizeAccess)(request, env);
  if (!access) {
    return json({ ok: false, code: "migration_apply_authorization_required", requiredRole: "admin" }, 401);
  }
  if (access.role !== "admin") {
    return json({ ok: false, code: "migration_apply_forbidden", requiredRole: "admin", role: access.role }, 403);
  }
  const context = (dependencies.createContext ?? createAuditContext)(access);

  try {
    if (pathname === STORAGE_MIGRATION_APPLY_STATUS_PATH) {
      const result = await (dependencies.status ?? inspectMigrationApplyStatus)(env);
      return json({ ...result, correlationId: context.correlationId }, 200, context.correlationId);
    }

    const body = await readInput(request);
    if (body.state === "too_large") {
      return json({ ok: false, code: "migration_apply_request_too_large", correlationId: context.correlationId }, 413, context.correlationId);
    }
    if (body.state === "invalid") {
      return json({ ok: false, code: "migration_apply_request_invalid", correlationId: context.correlationId }, 400, context.correlationId);
    }

    const result = pathname === STORAGE_MIGRATION_APPLY_PATH
      ? await (dependencies.apply ?? applyControlledStorageMigrations)(env, context, body.input)
      : pathname === STORAGE_MIGRATION_RECONCILE_PATH
        ? await (dependencies.reconcile ?? reconcileControlledStorageMigration)(env, context, body.input)
        : null;
    if (!result) return json({ ok: false, code: "migration_apply_unavailable", correlationId: context.correlationId }, 503, context.correlationId);
    return json({ ...result, correlationId: context.correlationId }, 200, context.correlationId);
  } catch (error) {
    const failure = safeFailure(error);
    return json({ ok: false, code: failure.code, correlationId: context.correlationId }, failure.status, context.correlationId);
  }
}
