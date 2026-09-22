import { createAuditContext, type AuditContext } from "../audit-log.ts";
import { handleBackupExportRequest } from "./backup-export-entry.ts";
import {
  portalAccess,
  requirePortalPermission,
  type PortalAccessEnv,
} from "./portal-access-runtime.ts";

export const SANITIZED_BACKUP_EXPORT_PATH = "/api/admin/backups/export";

export type BackupHttpEnv =
  PortalAccessEnv
  & Parameters<typeof handleBackupExportRequest>[1];

export type BackupHttpDependencies = {
  exportHandler?: typeof handleBackupExportRequest;
  createContext?: (access: ReturnType<typeof portalAccess>) => AuditContext;
};

export async function handleBackupHttpRequest(
  request: Request,
  env: BackupHttpEnv,
  dependencies: BackupHttpDependencies = {},
): Promise<Response | null> {
  if (new URL(request.url).pathname !== SANITIZED_BACKUP_EXPORT_PATH) return null;

  const denied = requirePortalPermission(request, env, "backup.export");
  if (denied) return denied;

  const contextFactory = dependencies.createContext ?? createAuditContext;
  return (dependencies.exportHandler ?? handleBackupExportRequest)(
    request,
    env,
    contextFactory(portalAccess(request, env)),
  );
}
