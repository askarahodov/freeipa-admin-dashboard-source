import { createAuditContext, type AuditContext } from "../audit-log.ts";
import type { BackupExportEnv } from "../backup-export.ts";
import { handleBackupImportPreviewRequest } from "./backup-import-preview-entry.ts";

type PortalRole = "viewer" | "operator" | "admin";

export type BackupPreviewAccessEnv = BackupExportEnv & {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};

export type BackupPreviewAccess = {
  identity: string;
  role: PortalRole;
  groups: string[];
  permissions: Array<"backup.restore.preview">;
};

export type BackupImportPreviewDispatchDependencies = {
  handler?: typeof handleBackupImportPreviewRequest;
  createContext?: (access: BackupPreviewAccess) => AuditContext;
};

function portalRole(value: unknown): PortalRole | null {
  return value === "viewer" || value === "operator" || value === "admin" ? value : null;
}

function portalIdentity(request: Request, env: BackupPreviewAccessEnv): string {
  const mode = String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase();
  const configured = mode === "static" ? env.PORTAL_STATIC_IDENTITY : undefined;
  return String(configured || request.headers.get("oai-authenticated-user-email") || "portal-user")
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

export function backupPreviewAccess(request: Request, env: BackupPreviewAccessEnv): BackupPreviewAccess {
  const identity = portalIdentity(request, env);
  const groups = Array.from(new Set(
    String(request.headers.get("oai-authenticated-user-groups") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value && value.length <= 120 && !/[\r\n]/.test(value)),
  )).slice(0, 100);

  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE || "").trim().toLowerCase()) ?? "admin";
  if (env.PORTAL_RBAC_JSON) {
    try {
      const assignments = JSON.parse(env.PORTAL_RBAC_JSON) as unknown;
      if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        const normalized = Object.fromEntries(
          Object.entries(assignments as Record<string, unknown>)
            .map(([key, value]) => [key.trim().toLowerCase(), value]),
        );
        role = portalRole(normalized[identity]) ?? portalRole(normalized["*"]) ?? role;
      }
    } catch {
      // Invalid RBAC JSON never grants a role beyond the explicit default.
    }
  }

  return {
    identity,
    role,
    groups,
    permissions: role === "admin" ? ["backup.restore.preview"] : [],
  };
}

export async function handleBackupImportPreviewRoute(
  request: Request,
  env: BackupPreviewAccessEnv,
  dependencies: BackupImportPreviewDispatchDependencies = {},
): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/admin/backups/import/preview") return null;

  const access = backupPreviewAccess(request, env);
  if (!access.permissions.includes("backup.restore.preview")) {
    return new Response(JSON.stringify({
      error: "Insufficient permission for this operation",
      requiredPermission: "backup.restore.preview",
      role: access.role,
    }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const handler = dependencies.handler ?? handleBackupImportPreviewRequest;
  const createContext = dependencies.createContext ?? createAuditContext;
  return handler(request, env, createContext(access));
}
