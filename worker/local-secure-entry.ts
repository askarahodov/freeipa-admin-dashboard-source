import secureRuntime from "./secure-entry";
import { appendAuditEvent, createAuditContext } from "../audit-log";
import {
  authenticateLocalUser,
  bootstrapLocalAdmin,
  clearLocalSessionCookie,
  createLocalUser,
  deleteLocalUser,
  listLocalUsers,
  localAuthState,
  localSessionCookie,
  resetLocalUserPassword,
  resolveLocalSession,
  revokeLocalSession,
  revokeLocalUserSessions,
  updateLocalUser,
  type LocalAuthEnv,
  type LocalSession,
} from "../local-auth";

type RuntimeEnv = NonNullable<Parameters<typeof secureRuntime.fetch>[1]> & LocalAuthEnv & {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};
type RuntimeContext = Parameters<typeof secureRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof secureRuntime.scheduled>>[0];

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(jsonHeaders);
  if (extraHeaders) for (const [key, value] of new Headers(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(data), { status, headers });
}

function localMode(env: RuntimeEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

function publicSession(session: LocalSession) {
  return {
    id: session.userId,
    username: session.username,
    identity: session.identity,
    displayName: session.displayName,
    role: session.role,
    expiresAt: session.expiresAt,
  };
}

function delegatedEnv(env: RuntimeEnv, session: LocalSession): RuntimeEnv {
  return {
    ...env,
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: session.identity,
    PORTAL_STATIC_NAME: session.displayName,
    PORTAL_DEFAULT_ROLE: session.role,
    PORTAL_RBAC_JSON: JSON.stringify({ [session.identity]: session.role }),
  };
}

async function requireAdmin(env: RuntimeEnv, request: Request): Promise<LocalSession | Response> {
  const session = await resolveLocalSession(env, request);
  if (!session) return json({ error: "Требуется повторный вход" }, 401);
  if (session.role !== "admin") return json({ error: "Недостаточно прав для управления доступом" }, 403);
  return session;
}

async function handleAuthApi(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  if (!localMode(env)) return json({ enabled: false, authenticated: true }, request.method === "GET" ? 200 : 409);
  if (!env.DB) return json({ enabled: true, authenticated: false, error: "Локальная база данных недоступна" }, 503);

  try {
    await bootstrapLocalAdmin(env);
  } catch (error) {
    return json({ enabled: true, authenticated: false, error: error instanceof Error ? error.message : "Не удалось инициализировать локальную аутентификацию" }, 503);
  }

  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    const [session, state] = await Promise.all([resolveLocalSession(env, request), localAuthState(env)]);
    if (!session) return json({ enabled: true, authenticated: false, ...state }, 401);
    return json({ enabled: true, authenticated: true, setupRequired: false, user: publicSession(session) });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const body = await request.json() as Record<string, unknown>;
      const authenticated = await authenticateLocalUser(env, body.username, body.password, request.headers.get("user-agent") ?? "");
      return json(
        { enabled: true, authenticated: true, user: publicSession(authenticated.session) },
        200,
        { "set-cookie": localSessionCookie(request, authenticated.token, authenticated.maxAge) },
      );
    } catch (error) {
      return json({ enabled: true, authenticated: false, error: error instanceof Error ? error.message : "Не удалось выполнить вход" }, 401);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    await revokeLocalSession(env, request);
    return json({ enabled: true, authenticated: false }, 200, { "set-cookie": clearLocalSessionCookie(request) });
  }

  const current = await requireAdmin(env, request);
  if (current instanceof Response) return current;
  const audit = createAuditContext({ identity: current.identity, role: current.role, groups: [] });

  if (url.pathname === "/api/auth/users") {
    if (request.method === "GET") return json({ users: await listLocalUsers(env) });
    if (request.method === "POST") {
      try {
        const body = await request.json() as Record<string, unknown>;
        const user = await createLocalUser(env, {
          username: body.username,
          displayName: body.displayName,
          password: body.password,
          role: body.role,
        });
        await appendAuditEvent(env, audit, {
          action: "rbac.user.created",
          resourceType: "portal_user",
          resourceId: user.id,
          outcome: "success",
          metadata: { username: user.username, role: user.role },
        }).catch(() => {});
        return json({ user }, 201);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Не удалось создать пользователя" }, 400);
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const match = url.pathname.match(/^\/api\/auth\/users\/([A-Za-z0-9-]{1,80})(?:\/(password|sessions))?$/);
  if (!match) return json({ error: "Not found" }, 404);
  const userId = match[1];
  const action = match[2] ?? "";

  if (action === "password" && request.method === "POST") {
    try {
      const body = await request.json() as Record<string, unknown>;
      await resetLocalUserPassword(env, userId, body.password);
      await appendAuditEvent(env, audit, {
        action: "rbac.user.password_reset",
        resourceType: "portal_user",
        resourceId: userId,
        outcome: "success",
        metadata: { sessionsRevoked: true },
      }).catch(() => {});
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Не удалось сменить пароль" }, 400);
    }
  }

  if (action === "sessions" && request.method === "DELETE") {
    await revokeLocalUserSessions(env, userId);
    await appendAuditEvent(env, audit, {
      action: "rbac.user.sessions_revoked",
      resourceType: "portal_user",
      resourceId: userId,
      outcome: "success",
      metadata: {},
    }).catch(() => {});
    return json({ ok: true });
  }

  if (!action && request.method === "PUT") {
    try {
      const body = await request.json() as Record<string, unknown>;
      if (current.userId === userId && (body.disabled === true || (body.role !== undefined && body.role !== "admin"))) {
        return json({ error: "Нельзя отключить или понизить собственную активную учётную запись" }, 400);
      }
      const user = await updateLocalUser(env, userId, {
        displayName: body.displayName,
        role: body.role,
        disabled: body.disabled,
      });
      await appendAuditEvent(env, audit, {
        action: "rbac.user.updated",
        resourceType: "portal_user",
        resourceId: user.id,
        outcome: "success",
        metadata: { username: user.username, role: user.role, disabled: user.disabled },
      }).catch(() => {});
      return json({ user });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Не удалось обновить пользователя" }, 400);
    }
  }

  if (!action && request.method === "DELETE") {
    if (current.userId === userId) return json({ error: "Нельзя удалить собственную активную учётную запись" }, 400);
    try {
      await deleteLocalUser(env, userId);
      await appendAuditEvent(env, audit, {
        action: "rbac.user.deleted",
        resourceType: "portal_user",
        resourceId: userId,
        outcome: "success",
        metadata: {},
      }).catch(() => {});
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Не удалось удалить пользователя" }, 400);
    }
  }

  return json({ error: "Method not allowed" }, 405);
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);
    if (!localMode(sourceEnv)) return secureRuntime.fetch(request, sourceEnv, ctx);

    if (url.pathname.startsWith("/api/auth/")) return handleAuthApi(request, sourceEnv, url);
    if (url.pathname === "/api/integrations/health") return secureRuntime.fetch(request, sourceEnv, ctx);

    const session = await resolveLocalSession(sourceEnv, request);
    if (!session) {
      if (url.pathname.startsWith("/api/")) return json({ error: "Требуется вход в портал" }, 401);
      if (request.method === "GET" && request.headers.get("accept")?.includes("text/html") && url.pathname !== "/login") {
        const next = `${url.pathname}${url.search}`;
        return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url), 302);
      }
      return secureRuntime.fetch(request, { ...sourceEnv, PORTAL_IDENTITY_MODE: "anonymous", PORTAL_DEFAULT_ROLE: "viewer" }, ctx);
    }

    if (url.pathname === "/login") return Response.redirect(new URL("/", request.url), 302);
    if (url.pathname === "/access" && session.role !== "admin") return new Response("Недостаточно прав", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    return secureRuntime.fetch(request, delegatedEnv(sourceEnv, session), ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return secureRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
