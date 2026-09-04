import bulkRuntime from "./freeipa-user-bulk-entry";
import {
  normalizeFreeIpaGroupMemberQuery,
  queryFreeIpaGroupMembers,
  type FreeIpaDirectoryGroup,
} from "../src/freeipa/freeipa-group-member-query";
import type { FreeIpaDirectoryUser } from "../src/freeipa/freeipa-user-query";
import {
  isPortalRole,
  portalRolePermissions,
} from "../src/auth/portal-permissions";
import { handleBackupImportPreviewRoute, type BackupPreviewAccessEnv } from "./backup-import-preview-root-entry";
import { handleEncryptedBackupRoute, type EncryptedBackupAccessEnv } from "./backup-encrypted-root-entry";

type RuntimeEnv = NonNullable<Parameters<typeof bulkRuntime.fetch>[1]> & BackupPreviewAccessEnv & EncryptedBackupAccessEnv;
type RuntimeContext = Parameters<typeof bulkRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof bulkRuntime.scheduled>>[0];

type GroupsPayload = { mode?: string; groups?: unknown; error?: string };
type UsersPayload = { mode?: string; users?: unknown; error?: string };
type StatusPayload = {
  access?: {
    identity?: unknown;
    role?: unknown;
    permissions?: unknown;
  };
  [key: string]: unknown;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function normalizeGroupName(value: string | null): string {
  const group = String(value ?? "").trim();
  return group.length <= 160 && /^[A-Za-z0-9_.@$-]+$/.test(group) ? group : "";
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

function userArray(value: unknown): FreeIpaDirectoryUser[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FreeIpaDirectoryUser => Boolean(
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && typeof (item as { uid?: unknown }).uid === "string",
  ));
}

async function readPayload<T>(response: Response): Promise<T & { error?: string }> {
  const payload = await response.json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as T & { error?: string }
    : {} as T & { error?: string };
}

async function withEffectivePermissions(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as StatusPayload | null;
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

async function handleGroupMembers(request: Request, env: RuntimeEnv, ctx: RuntimeContext, url: URL): Promise<Response> {
  const groupName = normalizeGroupName(url.searchParams.get("group"));
  if (!groupName) return json({ error: "Некорректная группа FreeIPA" }, 400);

  const groupsUrl = new URL(request.url);
  groupsUrl.pathname = "/api/integrations/groups";
  groupsUrl.search = "";
  const usersUrl = new URL(request.url);
  usersUrl.pathname = "/api/integrations/users";
  usersUrl.search = "";

  const [groupsResponse, usersResponse] = await Promise.all([
    bulkRuntime.fetch(new Request(groupsUrl, { headers: request.headers }), env, ctx),
    bulkRuntime.fetch(new Request(usersUrl, { headers: request.headers }), env, ctx),
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

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const encryptedBackupResponse = await handleEncryptedBackupRoute(request, sourceEnv);
    if (encryptedBackupResponse) return encryptedBackupResponse;
    const previewResponse = await handleBackupImportPreviewRoute(request, sourceEnv);
    if (previewResponse) return previewResponse;

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/integrations/groups/members") {
      return handleGroupMembers(request, sourceEnv, ctx, url);
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/status") {
      const response = await bulkRuntime.fetch(request, sourceEnv, ctx);
      return withEffectivePermissions(response);
    }
    return bulkRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return bulkRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
