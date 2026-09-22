import runtime from "./freeipa-http-entry.ts";
import { createAuditContext, type AuditContext } from "../audit-log.ts";
import { handleBackupExportRequest } from "./backup-export-entry.ts";
import { portalAccess, requirePortalPermission } from "./portal-access-runtime.ts";

export const SANITIZED_BACKUP_EXPORT_PATH = "/api/admin/backups/export";

export type BackupHttpEnv =
  NonNullable<Parameters<typeof runtime.fetch>[1]>
  & Parameters<typeof handleBackupExportRequest>[1];

type RuntimeContext = Parameters<typeof runtime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof runtime.scheduled>>[0];

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

const worker = {
  async fetch(request: Request, env: BackupHttpEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as BackupHttpEnv);
    const response = await handleBackupHttpRequest(request, sourceEnv);
    if (response) return response;
    return runtime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: BackupHttpEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return runtime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
