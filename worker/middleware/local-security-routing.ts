import {
  isAdminIntegrationPath,
  localAdminSessionToken,
  sameOriginAdminMutation,
  serviceAdminTokenAuthorized,
} from "../../src/auth/admin-session-authorization.ts";
import { STORAGE_INTEGRITY_PATH } from "../../src/storage/integrity/storage-integrity-contract.ts";
import { STORAGE_MIGRATION_PREFLIGHT_PATH } from "../../src/storage/migration/preflight/storage-migration-preflight-contract.ts";

export type LocalSecuritySession = Readonly<{
  userId: string;
  identity: string;
  displayName: string;
  role: string;
  expiresAt: number;
}>;

export type LocalSecurityRuntimeEnv = {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  ADMIN_TOKEN?: string;
};

export type LocalSecurityRoutingDependencies<RuntimeEnv, RuntimeContext> = Readonly<{
  resolveSession: (env: RuntimeEnv, request: Request) => Promise<LocalSecuritySession | null>;
  handleAuthApi: (request: Request, env: RuntimeEnv, url: URL) => Promise<Response>;
  handleStorageMigrationPreflight: (request: Request, env: RuntimeEnv) => Promise<Response | null>;
  handleStorageIntegrity: (request: Request, env: RuntimeEnv) => Promise<Response | null>;
  handleStorageStatus: (request: Request, env: RuntimeEnv) => Promise<Response | null>;
  nextFetch: (request: Request, env: RuntimeEnv, ctx: RuntimeContext) => Promise<Response>;
}>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function localMode(env: LocalSecurityRuntimeEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

function delegatedEnv<RuntimeEnv extends LocalSecurityRuntimeEnv>(
  env: RuntimeEnv,
  session: LocalSecuritySession,
  internalAdminToken?: string,
): RuntimeEnv {
  return {
    ...env,
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: session.identity,
    PORTAL_STATIC_NAME: session.displayName,
    PORTAL_DEFAULT_ROLE: session.role,
    PORTAL_RBAC_JSON: JSON.stringify({ [session.identity]: session.role }),
    ADMIN_TOKEN: internalAdminToken ?? env.ADMIN_TOKEN,
  } as RuntimeEnv;
}

function serviceAdminEnv<RuntimeEnv extends LocalSecurityRuntimeEnv>(env: RuntimeEnv): RuntimeEnv {
  const identity = "service-admin@portal.local";
  return {
    ...env,
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_STATIC_NAME: "Service administrator",
    PORTAL_DEFAULT_ROLE: "admin",
    PORTAL_RBAC_JSON: JSON.stringify({ [identity]: "admin" }),
  } as RuntimeEnv;
}

/**
 * Route-specific local security/session decision boundary extracted from the
 * historical local-secure Worker wrapper.
 *
 * This gate intentionally preserves the existing branch order rather than
 * imposing one universal auth/origin pipeline:
 * - non-local storage recovery paths keep their explicit service-token rules;
 * - /api/auth/** remains owned by the local-auth handler, including its
 *   mutation-origin-before-admin semantics;
 * - ordinary local API traffic resolves a session before same-origin checks;
 * - the allowlisted service-admin fallback remains available only after local
 *   session resolution fails;
 * - caller-provided x-admin-token is stripped before authenticated delegation,
 *   and an internal token is inserted only for a valid local admin session on
 *   an allowlisted same-origin administrative integration request.
 */
export async function handleLocalSecurityRouting<
  RuntimeEnv extends LocalSecurityRuntimeEnv,
  RuntimeContext,
>(
  request: Request,
  env: RuntimeEnv,
  ctx: RuntimeContext,
  dependencies: LocalSecurityRoutingDependencies<RuntimeEnv, RuntimeContext>,
): Promise<Response> {
  const url = new URL(request.url);

  if (!localMode(env)) {
    if (url.pathname === STORAGE_MIGRATION_PREFLIGHT_PATH) {
      if (!await serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)) {
        return json({ error: "Требуется токен администратора" }, 401);
      }
      const delegated = serviceAdminEnv(env);
      const preflightResponse = await dependencies.handleStorageMigrationPreflight(request, delegated);
      if (preflightResponse) return preflightResponse;
    }
    if (url.pathname === STORAGE_INTEGRITY_PATH) {
      if (!await serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)) {
        return json({ error: "Требуется токен администратора" }, 401);
      }
      const delegated = serviceAdminEnv(env);
      const integrityResponse = await dependencies.handleStorageIntegrity(request, delegated);
      if (integrityResponse) return integrityResponse;
    }
    const storageResponse = await dependencies.handleStorageStatus(request, env);
    if (storageResponse) return storageResponse;
    return dependencies.nextFetch(request, env, ctx);
  }

  if (url.pathname.startsWith("/api/auth/")) return dependencies.handleAuthApi(request, env, url);
  if (url.pathname === "/api/integrations/health") return dependencies.nextFetch(request, env, ctx);

  const session = await dependencies.resolveSession(env, request);
  if (!session) {
    if (isAdminIntegrationPath(url.pathname) && await serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)) {
      const delegated = serviceAdminEnv(env);
      const preflightResponse = await dependencies.handleStorageMigrationPreflight(request, delegated);
      if (preflightResponse) return preflightResponse;
      const integrityResponse = await dependencies.handleStorageIntegrity(request, delegated);
      if (integrityResponse) return integrityResponse;
      const storageResponse = await dependencies.handleStorageStatus(request, delegated);
      if (storageResponse) return storageResponse;
      return dependencies.nextFetch(request, delegated, ctx);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Требуется вход в портал" }, 401);
    if (request.method === "GET" && request.headers.get("accept")?.includes("text/html") && url.pathname !== "/login") {
      const next = `${url.pathname}${url.search}`;
      return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url), 302);
    }
    return dependencies.nextFetch(
      request,
      { ...env, PORTAL_IDENTITY_MODE: "anonymous", PORTAL_DEFAULT_ROLE: "viewer" } as RuntimeEnv,
      ctx,
    );
  }

  if (url.pathname === "/login") return Response.redirect(new URL("/", request.url), 302);
  if (url.pathname === "/access" && session.role !== "admin") {
    return new Response("Недостаточно прав", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const headers = new Headers(request.headers);
  headers.delete("x-admin-token");
  let delegated = delegatedEnv(env, session);
  if (session.role === "admin" && isAdminIntegrationPath(url.pathname)) {
    if (!sameOriginAdminMutation(request)) {
      return json({ error: "Административный запрос заблокирован проверкой источника" }, 403);
    }
    const internalToken = localAdminSessionToken(session);
    headers.set("x-admin-token", internalToken);
    delegated = delegatedEnv(env, session, internalToken);
  }

  const delegatedRequest = new Request(request, { headers });
  const preflightResponse = await dependencies.handleStorageMigrationPreflight(delegatedRequest, delegated);
  if (preflightResponse) return preflightResponse;
  const integrityResponse = await dependencies.handleStorageIntegrity(delegatedRequest, delegated);
  if (integrityResponse) return integrityResponse;
  const storageResponse = await dependencies.handleStorageStatus(delegatedRequest, delegated);
  if (storageResponse) return storageResponse;
  return dependencies.nextFetch(delegatedRequest, delegated, ctx);
}
