import queryRuntime from "./freeipa-user-query-entry";
import { normalizeFreeIpaUserQuery, queryFreeIpaUsers, type FreeIpaDirectoryUser } from "../freeipa-user-query";

type RuntimeEnv = NonNullable<Parameters<typeof queryRuntime.fetch>[1]>;
type RuntimeContext = Parameters<typeof queryRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof queryRuntime.scheduled>>[0];
type BulkAction = "enable" | "disable" | "add_to_group";

type PublicStatus = {
  access?: { permissions?: unknown };
};

type LegacyUsersPayload = {
  mode?: string;
  users?: unknown;
  error?: string;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const maxBulkUsers = 50;
const bulkConcurrency = 3;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
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

function normalizeUid(value: unknown): string {
  const uid = String(value ?? "").trim();
  return uid.length <= 160 && /^[A-Za-z0-9_.@$-]+$/.test(uid) ? uid : "";
}

function normalizeUsers(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("users must be an array");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const uid = normalizeUid(raw);
    if (!uid) throw new Error("Список содержит некорректный логин");
    if (seen.has(uid)) continue;
    seen.add(uid);
    result.push(uid);
    if (result.length > maxBulkUsers) throw new Error(`За один запуск можно обработать не более ${maxBulkUsers} пользователей`);
  }
  if (!result.length) throw new Error("Выберите хотя бы одного пользователя");
  return result;
}

function normalizeAction(value: unknown): BulkAction {
  if (value === "enable" || value === "disable" || value === "add_to_group") return value;
  throw new Error("Unsupported bulk action");
}

function normalizeGroup(value: unknown, required: boolean): string {
  const group = String(value ?? "").trim();
  if (!required && !group) return "";
  if (!group || group.length > 160 || !/^[A-Za-z0-9_.@$-]+$/.test(group)) throw new Error("Некорректная группа FreeIPA");
  return group;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

async function preflightWrite(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response | null> {
  const statusUrl = new URL(request.url);
  statusUrl.pathname = "/api/integrations/status";
  statusUrl.search = "";
  const response = await queryRuntime.fetch(new Request(statusUrl, { headers: request.headers }), env, ctx);
  if (!response.ok) return response;
  const payload = await readJson(response) as PublicStatus;
  const permissions = Array.isArray(payload.access?.permissions) ? payload.access.permissions.map(String) : [];
  return permissions.includes("freeipa.write")
    ? null
    : json({ error: "Недостаточно прав для массового изменения FreeIPA", requiredPermission: "freeipa.write" }, 403);
}

async function handleBulk(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: "Invalid JSON" }, 400); }

  let action: BulkAction;
  let users: string[];
  let group: string;
  try {
    action = normalizeAction(body.action);
    users = normalizeUsers(body.users);
    group = normalizeGroup(body.group, action === "add_to_group");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Некорректные параметры массовой операции" }, 400);
  }

  const denied = await preflightWrite(request, env, ctx);
  if (denied) return denied;

  const operation = action === "enable" ? "user_enable" : action === "disable" ? "user_disable" : "group_add_member";
  const results = new Array<{ uid: string; ok: boolean; status: number; runId: string; error: string }>(users.length);
  let cursor = 0;

  const execute = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= users.length) return;
      const uid = users[index];
      const actionUrl = new URL(request.url);
      actionUrl.pathname = "/api/integrations/freeipa/actions";
      actionUrl.search = "";
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      headers.delete("content-length");
      const response = await queryRuntime.fetch(new Request(actionUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ operation, username: uid, ...(group ? { group } : {}) }),
      }), env, ctx);
      const payload = await readJson(response);
      results[index] = {
        uid,
        ok: response.ok && payload.ok !== false,
        status: response.status,
        runId: typeof payload.runId === "string" ? payload.runId : "",
        error: response.ok ? "" : String(payload.error ?? `HTTP ${response.status}`).slice(0, 500),
      };
    }
  };

  await Promise.all(Array.from({ length: Math.min(bulkConcurrency, users.length) }, () => execute()));
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  return json({
    ok: failed === 0,
    action,
    group: group || null,
    requested: results.length,
    succeeded,
    failed,
    results,
  }, failed === 0 ? 200 : 207);
}

function csvCell(value: unknown): string {
  let text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function handleExport(request: Request, env: RuntimeEnv, ctx: RuntimeContext, url: URL): Promise<Response> {
  const upstreamUrl = new URL(request.url);
  upstreamUrl.pathname = "/api/integrations/users";
  upstreamUrl.search = "";
  const upstream = await queryRuntime.fetch(new Request(upstreamUrl, { headers: request.headers }), env, ctx);
  if (!upstream.ok) return upstream;
  const payload = await readJson(upstream) as LegacyUsersPayload;
  if (payload.mode !== "live") return json({ error: "Экспорт доступен только при активном подключении FreeIPA" }, 503);

  const users = userArray(payload.users);
  const normalized = normalizeFreeIpaUserQuery(url.searchParams);
  const result = queryFreeIpaUsers(users, { ...normalized, page: 1, pageSize: Math.max(users.length, 1) });
  const header = ["Логин", "Имя", "Email", "Статус", "Количество групп", "Группы"];
  const rows = result.users.map((user) => [
    user.uid,
    user.name,
    user.email,
    user.active ? "Активен" : "Отключён",
    user.groups,
    user.groupNames.join(", "),
  ]);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
  const filename = `freeipa-users-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-exported-users": String(result.users.length),
    },
  });
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/integrations/freeipa/bulk") {
      return handleBulk(request, sourceEnv, ctx);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/users/export.csv") {
      return handleExport(request, sourceEnv, ctx, url);
    }
    return queryRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return queryRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
