import localRuntime from "./local-secure-entry";
import { listLocalUsers, resolveLocalSession, type LocalAuthEnv } from "../local-auth";

type RuntimeEnv = NonNullable<Parameters<typeof localRuntime.fetch>[1]> & LocalAuthEnv & {
  PORTAL_IDENTITY_MODE?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  ADMIN_TOKEN?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_NODE_GATEWAY_URL?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
};
type RuntimeContext = Parameters<typeof localRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof localRuntime.scheduled>>[0];

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const countableTables = [
  "app_settings",
  "operation_runs",
  "portal_audit_events",
  "portal_users",
  "portal_sessions",
  "process_presentation_sets",
  "xyops_catalog_history",
  "xyops_catalog_snapshot",
] as const;

type CountableTable = typeof countableTables[number];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function localMode(env: RuntimeEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

async function tableCount(env: RuntimeEnv, table: CountableTable): Promise<number | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

async function databaseSize(env: RuntimeEnv): Promise<number | null> {
  if (!env.DB) return null;
  try {
    const [pageCount, pageSize] = await Promise.all([
      env.DB.prepare("PRAGMA page_count").first<Record<string, unknown>>(),
      env.DB.prepare("PRAGMA page_size").first<Record<string, unknown>>(),
    ]);
    const count = Number(pageCount?.page_count ?? Object.values(pageCount ?? {})[0] ?? 0);
    const size = Number(pageSize?.page_size ?? Object.values(pageSize ?? {})[0] ?? 0);
    return Number.isFinite(count) && Number.isFinite(size) && count > 0 && size > 0 ? count * size : null;
  } catch {
    return null;
  }
}

async function integrationStatus(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Record<string, unknown>> {
  try {
    const url = new URL("/api/integrations/status", request.url);
    const response = await localRuntime.fetch(new Request(url, { headers: request.headers }), env, ctx);
    if (!response.ok) return { available: false, statusCode: response.status };
    return await response.json() as Record<string, unknown>;
  } catch {
    return { available: false, statusCode: 503 };
  }
}

async function diagnostics(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!localMode(env)) return json({ error: "Локальная диагностика доступна только в local mode" }, 409);
  if (!env.DB) return json({ error: "Локальная база данных недоступна" }, 503);

  const session = await resolveLocalSession(env, request);
  if (!session) return json({ error: "Требуется повторный вход" }, 401);
  if (session.role !== "admin") return json({ error: "Недостаточно прав для диагностики" }, 403);

  const [users, sizeBytes, status, ...counts] = await Promise.all([
    listLocalUsers(env),
    databaseSize(env),
    integrationStatus(request, env, ctx),
    ...countableTables.map((table) => tableCount(env, table)),
  ]);
  const tableCounts = Object.fromEntries(countableTables.map((table, index) => [table, counts[index]]));
  const activeUsers = users.filter((user) => !user.disabled);

  return json({
    generatedAt: Date.now(),
    portal: {
      mode: "local",
      users: users.length,
      activeUsers: activeUsers.length,
      admins: activeUsers.filter((user) => user.role === "admin").length,
      operators: activeUsers.filter((user) => user.role === "operator").length,
      viewers: activeUsers.filter((user) => user.role === "viewer").length,
      disabledUsers: users.filter((user) => user.disabled).length,
      lockedUsers: users.filter((user) => Boolean(user.lockedUntil)).length,
      activeSessions: users.reduce((sum, user) => sum + user.activeSessions, 0),
    },
    database: {
      available: true,
      sizeBytes,
      tables: tableCounts,
    },
    configuration: {
      encryptionConfigured: Boolean(env.CONFIG_ENCRYPTION_KEY),
      adminTokenConfigured: Boolean(env.ADMIN_TOKEN),
      freeipaConfigured: Boolean(env.IPA_URL && env.IPA_USERNAME && env.IPA_PASSWORD),
      freeipaGatewayConfigured: Boolean(env.IPA_NODE_GATEWAY_URL),
      xyopsConfigured: Boolean(env.XYOPS_URL && env.XYOPS_API_KEY),
    },
    integrations: status,
  });
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (url.pathname === "/api/auth/diagnostics") return diagnostics(request, sourceEnv, ctx);
    if (url.pathname === "/diagnostics" && localMode(sourceEnv)) {
      const session = await resolveLocalSession(sourceEnv, request);
      if (!session) return Response.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname)}`, request.url), 302);
      if (session.role !== "admin") return new Response("Недостаточно прав", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return localRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return localRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;