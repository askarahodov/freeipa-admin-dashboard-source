import { createAuditContext, type AuditContext } from "../audit-log.ts";
import {
  encryptedBackupAccess,
  type EncryptedBackupAccess,
  type EncryptedBackupAccessEnv,
} from "./backup-encrypted-root-entry.ts";
import {
  handleMaintenanceControlRequest,
  MAINTENANCE_CONTROL_PATHS,
  type MaintenanceControlEnv,
} from "./maintenance-control-entry.ts";

export type MaintenanceControlRuntimeEnv = MaintenanceControlEnv & EncryptedBackupAccessEnv;

export type MaintenanceControlDispatchDependencies = {
  handler?: typeof handleMaintenanceControlRequest;
  createContext?: (access: EncryptedBackupAccess) => AuditContext;
};

function denied(role: EncryptedBackupAccess["role"]): Response {
  return new Response(JSON.stringify({
    error: "Insufficient permission for this operation",
    requiredPermission: "maintenance.manage",
    role,
  }), {
    status: 403,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function handleMaintenanceControlRoute(
  request: Request,
  env: MaintenanceControlRuntimeEnv,
  dependencies: MaintenanceControlDispatchDependencies = {},
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!MAINTENANCE_CONTROL_PATHS.includes(pathname)) return null;

  const access = encryptedBackupAccess(request, env);
  if (access.role !== "admin") return denied(access.role);

  const context = (dependencies.createContext ?? createAuditContext)(access);
  return (dependencies.handler ?? handleMaintenanceControlRequest)(request, env, context);
}
