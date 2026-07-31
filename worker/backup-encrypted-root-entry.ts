import { createAuditContext, type AuditContext } from "../audit-log.ts";
import type { BackupExportEnv } from "../backup-export.ts";
import { handleEncryptedBackupExportRequest } from "./backup-encrypted-export-entry.ts";
import { handleEncryptedBackupPreviewRequest } from "./backup-encrypted-preview-entry.ts";
import { handleIsolatedBackupRestoreRequest } from "./backup-isolated-restore-entry.ts";
import {
  handleSelectiveBackupRestoreRequest,
  SELECTIVE_RESTORE_CANCEL_PATH,
  SELECTIVE_RESTORE_COMMIT_PATH,
  SELECTIVE_RESTORE_PREPARE_PATH,
} from "./backup-selective-restore-entry.ts";

type PortalRole = "viewer" | "operator" | "admin";

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
  prepareHandler?: typeof handleSelectiveBackupRestoreRequest;
  commitHandler?: typeof handleSelectiveBackupRestoreRequest;
  cancelHandler?: typeof handleSelectiveBackupRestoreRequest;
  createContext?: (access: EncryptedBackupAccess) => AuditContext;
};

function portalRole(value: unknown): PortalRole | null {
  return value === "viewer" || value === "operator" || value === "admin" ? value : null;
}

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

  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE || "").trim().toLowerCase()) ?? "admin";
  if (env.PORTAL_RBAC_JSON) {
    try {
      const assignments = JSON.parse(env.PORTAL_RBAC_JSON) as unknown;
      if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        const normalized = Object.fromEntries(Object.entries(assignments as Record<string, unknown>)
          .map(([key, value]) => [key.trim().toLowerCase(), value]));
        role = portalRole(normalized[identity]) ?? portalRole(normalized["*"]) ?? role;
      }
    } catch {
      // Invalid JSON never grants more than the configured default role.
    }
  }
  return { identity, role, groups };
}

function denied(requiredPermission: string, role: PortalRole): Response {
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
  const selectivePaths = new Set([
    SELECTIVE_RESTORE_PREPARE_PATH,
    SELECTIVE_RESTORE_COMMIT_PATH,
    SELECTIVE_RESTORE_CANCEL_PATH,
  ]);
  if (pathname !== exportPath
      && pathname !== previewPath
      && pathname !== testRestorePath
      && !selectivePaths.has(pathname)) return null;

  const access = encryptedBackupAccess(request, env);
  const requiredPermission = pathname === exportPath
    ? "backup.export.encrypted"
    : pathname === testRestorePath
      ? "backup.restore.test"
      : pathname === SELECTIVE_RESTORE_PREPARE_PATH
        ? "backup.restore.prepare"
        : pathname === SELECTIVE_RESTORE_COMMIT_PATH
          ? "backup.restore.commit"
          : pathname === SELECTIVE_RESTORE_CANCEL_PATH
            ? "backup.restore.cancel"
            : "backup.restore.preview";
  if (access.role !== "admin") return denied(requiredPermission, access.role);

  const context = (dependencies.createContext ?? createAuditContext)(access);
  if (pathname === exportPath) {
    return (dependencies.exportHandler ?? handleEncryptedBackupExportRequest)(request, env, context);
  }
  if (pathname === testRestorePath) {
    return (dependencies.testRestoreHandler ?? handleIsolatedBackupRestoreRequest)(request, env, context);
  }
  if (pathname === SELECTIVE_RESTORE_PREPARE_PATH) {
    return (dependencies.prepareHandler ?? handleSelectiveBackupRestoreRequest)(request, env, context);
  }
  if (pathname === SELECTIVE_RESTORE_COMMIT_PATH) {
    return (dependencies.commitHandler ?? handleSelectiveBackupRestoreRequest)(request, env, context);
  }
  if (pathname === SELECTIVE_RESTORE_CANCEL_PATH) {
    return (dependencies.cancelHandler ?? handleSelectiveBackupRestoreRequest)(request, env, context);
  }
  return (dependencies.previewHandler ?? handleEncryptedBackupPreviewRequest)(request, env, context);
}
