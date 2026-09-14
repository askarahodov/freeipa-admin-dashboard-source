import integrationRuntime from "./index";
import {
  normalizeFreeIpaGroupMemberQuery,
  queryFreeIpaGroupMembers,
  type FreeIpaDirectoryGroup,
} from "../src/freeipa/freeipa-group-member-query";
import {
  normalizeFreeIpaUserQuery,
  queryFreeIpaUsers,
  type FreeIpaDirectoryUser,
} from "../src/freeipa/freeipa-user-query";
import { isPortalRole, portalRolePermissions } from "../src/auth/portal-permissions";
import { readFreeIpaGroups, readFreeIpaUsers } from "./freeipa-base-read.ts";
import { effectiveFreeIpaRuntime, type FreeIpaSettingsEnv } from "./integration-settings-runtime.ts";
import { appendAuditEvent, auditErrorCode, createAuditContext } from "../audit-log.ts";
import { freeIpaDirectCall, isFreeIpaOperation } from "./freeipa-action-runtime.ts";
import { freeIpaRpc } from "./freeipa-rpc.ts";
import { operationRun, saveOperationRun } from "./operation-run-runtime.ts";
import { portalAccess, requirePortalPermission } from "./portal-access-runtime.ts";

type RuntimeEnv = NonNullable<Parameters<typeof integrationRuntime.fetch>[1]> & FreeIpaSettingsEnv;
type RuntimeContext = Parameters<typeof integrationRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof integrationRuntime.scheduled>>[0];
type BulkAction = "enable" | "disable" | "add_to_group";

type PublicStatus = {
  access?: {
    identity?: unknown;
    role?: unknown;
    permissions?: unknown;
  };
  [key: string]: unknown;
};

type LegacyUsersPayload = {
  mode?: string;
  users?: unknown;
  error?: string;
};

type GroupsPayload = { mode?: string; groups?: unknown; error?: string };
type UsersPayload = { mode?: string; users?: unknown; error?: string };

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const queryKeys = new Set(["q", "status", "group", "sort", "direction", "page", "pageSize"]);
const maxBulkUsers = 50;
const bulkConcurrency = 3;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

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

function groupArray(value: unknown): FreeIpaDirectoryGroup[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FreeIpaDirectoryGroup => Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && typeof (item as { name?: unknown }).name === "string",
  ));
}

async function readRecord(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

async function readPayload<T>(response: Response): Promise<T & { error?: string }> {
  return await readRecord(response) as T & { error?: string };
}

async function baseUsers(env: RuntimeEnv): Promise<Response> {
  const runtime = await effectiveFreeIpaRuntime(env);
  return readFreeIpaUsers(runtime.env, runtime.ipaUrl);
}

async function baseGroups(env: RuntimeEnv): Promise<Response> {
  const runtime = await effectiveFreeIpaRuntime(env);
  return readFreeIpaGroups(runtime.env, runtime.ipaUrl);
}

async function handleUserQuery(env: RuntimeEnv, url: URL): Promise<Response> {
  const upstream = await baseUsers(env);
  if (!upstream.ok) return upstream;

  const payload = await upstream.json().catch(() => null) as LegacyUsersPayload | null;
  if (!payload || typeof payload !== "object") {
    return json({ error: "Некорректный ответ каталога пользователей FreeIPA" }, 502);
  }

  const result = queryFreeIpaUsers(userArray(payload.users), normalizeFreeIpaUserQuery(url.searchParams));
  return json({ mode: payload.mode ?? "unconfigured", ...result });
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

async function preflightWrite(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response | null> {
  const statusUrl = new URL(request.url);
  statusUrl.pathname = "/api/integrations/status";
  statusUrl.search = "";
  const response = await integrationRuntime.fetch(new Request(statusUrl, { headers: request.headers }), env, ctx);
  if (!response.ok) return response;
  const payload = await readRecord(response) as PublicStatus;
  const permissions = Array.isArray(payload.access?.permissions) ? payload.access.permissions.map(String) : [];
  return permissions.includes("freeipa.write")
    ? null
    : json({ error: "Недостаточно прав для массового изменения FreeIPA", requiredPermission: "freeipa.write" }, 403);
}

async function handleFreeIpaAction(request: Request, env: RuntimeEnv): Promise<Response> {
  const audit = createAuditContext(portalAccess(request, env));
  const runtime = await effectiveFreeIpaRuntime(env);
  const effectiveEnv = runtime.env;
  const ipaUrl = runtime.ipaUrl;

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: "Invalid JSON" }, 400); }
  if (!isFreeIpaOperation(body.operation)) return json({ error: "Unsupported operation" }, 400);

  const requiredPermission = body.operation === "user_del" || body.operation === "group_del" ? "freeipa.delete" : "freeipa.write";
  const denied = requirePortalPermission(request, env, requiredPermission);
  if (denied) return denied;

  const demoMode = effectiveEnv.DEMO_MODE === "true";
  if (!demoMode && (!ipaUrl || !effectiveEnv.IPA_USERNAME || !effectiveEnv.IPA_PASSWORD)) return json({ error: "FreeIPA is not configured" }, 503);

  let call: ReturnType<typeof freeIpaDirectCall>;
  try { call = freeIpaDirectCall(body.operation, body); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Некорректные параметры FreeIPA" }, 400); }

  const fieldKeys = Object.keys(call.values).filter((key) => !/pass|secret|token|key/i.test(key));
  const resourceType = body.operation.startsWith("group_") ? "freeipa_group" : "freeipa_user";
  if (demoMode) {
    const run = operationRun({ request, eventId: `freeipa:${body.operation}`, title: call.title, kind: "event", mode: "demo", jobId: `IPA-DEMO-${Date.now()}`, status: "success", values: call.values });
    await saveOperationRun(env, run);
    await appendAuditEvent(env, audit, { action: `freeipa.${body.operation}`, resourceType, resourceId: run.subject, eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "demo", operation: body.operation, fieldKeys } }).catch(() => {});
    return json({ mode: "demo", direct: true, ok: true, runId: run.id, status: run.status });
  }

  try {
    await freeIpaRpc(effectiveEnv, ipaUrl as string, call.method, call.args, call.options);
    const run = operationRun({ request, eventId: `freeipa:${body.operation}`, title: call.title, kind: "event", mode: "live", jobId: `IPA-${Date.now()}`, status: "success", values: call.values });
    await saveOperationRun(env, run);
    await appendAuditEvent(env, audit, { action: `freeipa.${body.operation}`, resourceType, resourceId: run.subject, eventId: run.eventId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "live", operation: body.operation, fieldKeys } }).catch(() => {});
    return json({ mode: "live", direct: true, ok: true, runId: run.id, status: run.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FreeIPA request failed";
    const run = operationRun({ request, eventId: `freeipa:${body.operation}`, title: call.title, kind: "event", mode: "live", jobId: "", status: "failed", values: call.values, error: message });
    await saveOperationRun(env, run);
    await appendAuditEvent(env, audit, { action: `freeipa.${body.operation}`, resourceType, resourceId: run.subject, eventId: run.eventId, runId: run.id, outcome: "failure", errorCode: auditErrorCode(error, "freeipa_request_failed"), metadata: { operation: body.operation, fieldKeys } }).catch(() => {});
    return json({ error: message, runId: run.id }, 502);
  }
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
      const response = await handleFreeIpaAction(new Request(actionUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ operation, username: uid, ...(group ? { group } : {}) }),
      }), env);
      const payload = await readRecord(response);
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

async function handleExport(env: RuntimeEnv, url: URL): Promise<Response> {
  const upstream = await baseUsers(env);
  if (!upstream.ok) return upstream;
  const payload = await readRecord(upstream) as LegacyUsersPayload;
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

function normalizeGroupName(value: string | null): string {
  const group = String(value ?? "").trim();
  return group.length <= 160 && /^[A-Za-z0-9_.@$-]+$/.test(group) ? group : "";
}

async function handleGroupMembers(env: RuntimeEnv, url: URL): Promise<Response> {
  const groupName = normalizeGroupName(url.searchParams.get("group"));
  if (!groupName) return json({ error: "Некорректная группа FreeIPA" }, 400);

  const runtime = await effectiveFreeIpaRuntime(env);
  const [groupsResponse, usersResponse] = await Promise.all([
    readFreeIpaGroups(runtime.env, runtime.ipaUrl),
    readFreeIpaUsers(runtime.env, runtime.ipaUrl),
  ]);
  const [groupsPayload, usersPayload] = await Promise.all([
    readPayload<GroupsPayload>(groupsResponse),
    readPayload<UsersPayload>(usersResponse),
  ]);
  if (!groupsResponse.ok) return json({ error: groupsPayload.error || "Не удалось загрузить группы FreeIPA" }, groupsResponse.status);
  if (!usersResponse.ok) return json({ error: usersPayload.error || "Не удалось загрузить пользователей FreeIPA" }, usersResponse.status);

  const mode = groupsPayload.mode === "live" && usersPayload.mode === "live"
    ? "live"
    : groupsPayload.mode === "demo" || usersPayload.mode === "demo"
      ? "demo"
      : "unconfigured";
  if (mode === "unconfigured") return json({ mode, error: "FreeIPA is not configured" }, 503);

  const group = groupArray(groupsPayload.groups)
    .find((item) => item.name.toLocaleLowerCase("ru") === groupName.toLocaleLowerCase("ru"));
  if (!group) return json({ mode, error: "Группа FreeIPA не найдена" }, 404);

  const result = queryFreeIpaGroupMembers(group, userArray(usersPayload.users), normalizeFreeIpaGroupMemberQuery(url.searchParams));
  return json({ mode, ...result });
}

async function withEffectivePermissions(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as PublicStatus | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response;
  const role = payload.access?.role;
  if (!isPortalRole(role) || !payload.access) return response;
  return json({
    ...payload,
    access: {
      ...payload.access,
      permissions: [...portalRolePermissions[role]],
    },
  }, response.status);
}

/**
 * Single compatibility HTTP owner for FreeIPA directory reads and mutations
 * plus the consolidated query/export/bulk/member surface.
 *
 * B2 keeps persisted effective-settings precedence, the shared RPC transport,
 * canonical permission resolution, operation-run persistence and audit logging
 * reusable without delegating FreeIPA action ownership back to the central
 * integration runtime.
 */
const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/integrations/groups/members") {
      return handleGroupMembers(sourceEnv, url);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/status") {
      const response = await integrationRuntime.fetch(request, sourceEnv, ctx);
      return withEffectivePermissions(response);
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/freeipa/actions") {
      return handleFreeIpaAction(request, sourceEnv);
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/freeipa/bulk") {
      return handleBulk(request, sourceEnv, ctx);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/users/export.csv") {
      return handleExport(sourceEnv, url);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/users") {
      return hasUserQuery(url) ? handleUserQuery(sourceEnv, url) : baseUsers(sourceEnv);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/groups") {
      return baseGroups(sourceEnv);
    }
    return integrationRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return integrationRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
