import {
  portalRolePermissions,
  resolvePortalRole,
  type PortalPermission,
  type PortalRole,
} from "../src/auth/portal-permissions.ts";

export type PortalAccessEnv = {
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};

export type PortalAccess = {
  identity: string;
  role: PortalRole;
  groups: string[];
  permissions: PortalPermission[];
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function requestActor(request: Request): string {
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { return decodeURIComponent(encodedName).slice(0, 160); } catch {}
  }
  return (request.headers.get("oai-authenticated-user-email") || "portal-user").slice(0, 160);
}

export function portalAccess(request: Request, env: PortalAccessEnv): PortalAccess {
  const identity = (request.headers.get("oai-authenticated-user-email") || "portal-user").trim().toLowerCase().slice(0, 160);
  const groups = Array.from(new Set(String(request.headers.get("oai-authenticated-user-groups") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => value && value.length <= 120 && !/[\r\n]/.test(value)))).slice(0, 100);
  const role = resolvePortalRole(identity, env.PORTAL_DEFAULT_ROLE, env.PORTAL_RBAC_JSON, "admin");
  return { identity, role, groups, permissions: portalRolePermissions[role] };
}

export function requirePortalPermission(request: Request, env: PortalAccessEnv, permission: PortalPermission): Response | null {
  const access = portalAccess(request, env);
  return access.permissions.includes(permission)
    ? null
    : new Response(JSON.stringify({ error: "Недостаточно прав для выполнения операции", requiredPermission: permission, role: access.role }), { status: 403, headers: jsonHeaders });
}
