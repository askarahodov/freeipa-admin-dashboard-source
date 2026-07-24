import diagnosticsRuntime from "./diagnostics-entry";
import { appendAuditEvent, createAuditContext } from "../audit-log";
import { resolveLocalSession, type LocalAuthEnv } from "../local-auth";
import { listLocalPortalSessions, revokeLocalPortalSession } from "../local-session-management";

type RuntimeEnv = NonNullable<Parameters<typeof diagnosticsRuntime.fetch>[1]> & LocalAuthEnv & {
  PORTAL_IDENTITY_MODE?: string;
};
type RuntimeContext = Parameters<typeof diagnosticsRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof diagnosticsRuntime.scheduled>>[0];

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function localMode(env: RuntimeEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

async function requireAdmin(env: RuntimeEnv, request: Request) {
  if (!localMode(env)) return { response: json({ error: "Управление локальными сессиями доступно только в local mode" }, 409) };
  if (!env.DB) return { response: json({ error: "Локальная база данных недоступна" }, 503) };
  const session = await resolveLocalSession(env, request);
  if (!session) return { response: json({ error: "Требуется повторный вход" }, 401) };
  if (session.role !== "admin") return { response: json({ error: "Недостаточно прав для управления сессиями" }, 403) };
  return { session };
}

async function handleSessionsApi(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const authorization = await requireAdmin(env, request);
  if ("response" in authorization) return authorization.response;
  const current = authorization.session;

  if (request.method === "GET" && url.pathname === "/api/auth/sessions") {
    const limit = Number(url.searchParams.get("limit") ?? 200);
    const sessions = await listLocalPortalSessions(env, Number.isFinite(limit) ? limit : 200);
    return json({
      sessions: sessions.map((session) => ({ ...session, current: session.id === current.id })),
      currentSessionId: current.id,
    });
  }

  const match = url.pathname.match(/^\/api\/auth\/sessions\/([A-Za-z0-9-]{1,100})$/);
  if (!match) return json({ error: "Not found" }, 404);
  if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
  if (match[1] === current.id) return json({ error: "Текущую сессию нужно завершать через кнопку «Выйти»" }, 400);

  try {
    const revoked = await revokeLocalPortalSession(env, match[1]);
    const audit = createAuditContext({ identity: current.identity, role: current.role, groups: [] });
    await appendAuditEvent(env, audit, {
      action: "rbac.session.revoked",
      resourceType: "portal_session",
      resourceId: revoked.id,
      outcome: "success",
      metadata: { userId: revoked.userId, username: revoked.username },
    }).catch(() => {});
    return json({ ok: true, session: revoked });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Не удалось отозвать сессию" }, 404);
  }
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (url.pathname === "/api/auth/sessions" || url.pathname.startsWith("/api/auth/sessions/")) {
      return handleSessionsApi(request, sourceEnv, url);
    }

    if (url.pathname === "/sessions" && localMode(sourceEnv)) {
      const authorization = await requireAdmin(sourceEnv, request);
      if ("response" in authorization) {
        if (authorization.response.status === 401) return Response.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname)}`, request.url), 302);
        return new Response("Недостаточно прав", { status: authorization.response.status, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }

    return diagnosticsRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return diagnosticsRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;