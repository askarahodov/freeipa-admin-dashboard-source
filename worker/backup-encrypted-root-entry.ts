import { createAuditContext, type AuditContext } from "../audit-log.ts";
import type { BackupExportEnv } from "../backup-export.ts";
import {
  resolvePortalRole,
  roleHasPermission,
  type PortalPermission,
  type PortalRole,
} from "../portal-permissions.ts";
import { handleEncryptedBackupExportRequest } from "./backup-encrypted-export-entry.ts";
import { handleEncryptedBackupPreviewRequest } from "./backup-encrypted-preview-entry.ts";
import { handleIsolatedBackupRestoreRequest } from "./backup-isolated-restore-entry.ts";

export type EncryptedBackupAccessEnv = BackupExportEnv & {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};

export type EncryptedBackupAccess = {
  identity: string;
  role: PortalRole;
  groups: string[];
};

export type EncryptedBackupDispatchDependencies = {
  exportHandler?: typeof handleEncryptedBackupExportRequest;
  previewHandler?: typeof handleEncryptedBackupPreviewRequest;
  testRestoreHandler?: typeof handleIsolatedBackupRestoreRequest;
  createContext?: (access: EncryptedBackupAccess) => AuditContext;
};

function portalIdentity(request: Request, env: EncryptedBackupAccessEnv): string {
  const mode = String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase();
  const configured = mode === "static" ? env.PORTAL_STATIC_IDENTITY : undefined;
  return String(configured || request.headers.get("oai-authenticated-user-email") || "portal-user")
    .trim().toLowerCase().slice(0, 160);
}

export function encryptedBackupAccess(request: Request, env: EncryptedBackupAccessEnv): EncryptedBackupAccess {
  const identity = portalIdentity(request, env);
  const groups = Array.from(new Set(
    String(request.headers.get("oai-authenticated-user-groups") ?? "")
      .split(",").map((value) => value.trim().toLowerCase())
      .filter((value) => value && value.length <= 120 && !/[\r\n]/.test(value)),
  )).slice(0, 100);
  const role = resolvePortalRole(identity, env.PORTAL_DEFAULT_ROLE, env.PORTAL_RBAC_JSON, "admin");
  return { identity, role, groups };
}

function denied(requiredPermission: PortalPermission, role: PortalRole): Response {
  return new Response(JSON.stringify({
    error: "Insufficient permission for this operation",
    requiredPermission,
    role,
  }), {
    status: 403,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleEncryptedBackupRoute(
  request: Request,
  env: EncryptedBackupAccessEnv,
  dependencies: EncryptedBackupDispatchDependencies = {},
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const exportPath = "/api/admin/backups/export/encrypted";
  const previewPath = "/api/admin/backups/import/encrypted/preview";
  const testRestorePath = "/api/admin/backups/import/encrypted/test-restore";
  if (pathname !== exportPath && pathname !== previewPath && pathname !== testRestorePath) return null;

  const access = encryptedBackupAccess(request, env);
  const requiredPermission: PortalPermission = pathname === exportPath
    ? "backup.export.encrypted"
    : pathname === testRestorePath
      ? "backup.restore.test"
      : "backup.restore.preview";
  if (!roleHasPermission(access.role, requiredPermission)) return denied(requiredPermission, access.role);

  const context = (dependencies.createContext ?? createAuditContext)(access);
  if (pathname === exportPath) {
    return (dependencies.exportHandler ?? handleEncryptedBackupExportRequest)(request, env, context);
  }
  if (pathname === testRestorePath) {
    return (dependencies.testRestoreHandler ?? handleIsolatedBackupRestoreRequest)(request, env, context);
  }
  return (dependencies.previewHandler ?? handleEncryptedBackupPreviewRequest)(request, env, context);
}
