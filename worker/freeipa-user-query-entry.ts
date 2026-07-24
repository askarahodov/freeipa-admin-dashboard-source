import sessionRuntime from "./session-management-entry";
import { normalizeFreeIpaUserQuery, queryFreeIpaUsers, type FreeIpaDirectoryUser } from "../freeipa-user-query";

type RuntimeEnv = NonNullable<Parameters<typeof sessionRuntime.fetch>[1]>;
type RuntimeContext = Parameters<typeof sessionRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof sessionRuntime.scheduled>>[0];

type LegacyUsersPayload = {
  mode?: string;
  users?: unknown;
  error?: string;
};

const queryKeys = new Set(["q", "status", "group", "sort", "direction", "page", "pageSize"]);

function hasUserQuery(url: URL): boolean {
  return Array.from(url.searchParams.keys()).some((key) => queryKeys.has(key));
}

function userArray(value: unknown): FreeIpaDirectoryUser[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FreeIpaDirectoryUser => Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && typeof (item as { uid?: unknown }).uid === "string",
  ));
}

async function handleUserQuery(request: Request, env: RuntimeEnv, ctx: RuntimeContext, url: URL): Promise<Response> {
  const upstreamUrl = new URL(request.url);
  upstreamUrl.search = "";
  const upstream = await sessionRuntime.fetch(new Request(upstreamUrl, request), env, ctx);
  if (!upstream.ok) return upstream;

  const payload = await upstream.json().catch(() => null) as LegacyUsersPayload | null;
  if (!payload || typeof payload !== "object") {
    return new Response(JSON.stringify({ error: "Некорректный ответ каталога пользователей FreeIPA" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const result = queryFreeIpaUsers(userArray(payload.users), normalizeFreeIpaUserQuery(url.searchParams));
  return new Response(JSON.stringify({ mode: payload.mode ?? "unconfigured", ...result }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/integrations/users" && hasUserQuery(url)) {
      return handleUserQuery(request, sourceEnv, ctx, url);
    }

    return sessionRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return sessionRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
