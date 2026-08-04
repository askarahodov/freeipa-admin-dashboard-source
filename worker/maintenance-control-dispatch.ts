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
import {
  handleMaintenanceVerificationSmokeRequest,
  MAINTENANCE_VERIFICATION_SMOKE_PATH,
  type MaintenanceVerificationSmokeEnv,
} from "./maintenance-verification-smoke-entry.ts";

export type MaintenanceControlRuntimeEnv = MaintenanceControlEnv
  & MaintenanceVerificationSmokeEnv
  & EncryptedBackupAccessEnv
  & { PORTAL_SERVICE_ADMIN_AUTHORIZED?: string };

export type MaintenanceControlDispatchDependencies = {
  handler?: typeof handleMaintenanceControlRequest;
  smokeHandler?: typeof handleMaintenanceVerificationSmokeRequest;
  createContext?: (access: EncryptedBackupAccess) => AuditContext;
};

function denied(role: EncryptedBackupAccess["role"], requiredPermission = "maintenance.manage"): Response {
  return new Response(JSON.stringify({
    error: "Insufficient permission for this operation",
    requiredPermission,
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
  const smoke = pathname === MAINTENANCE_VERIFICATION_SMOKE_PATH;
  if (!smoke && !MAINTENANCE_CONTROL_PATHS.includes(pathname)) return null;

  const access = encryptedBackupAccess(request, env);
  if (access.role !== "admin") return denied(access.role);
  if (smoke && env.PORTAL_SERVICE_ADMIN_AUTHORIZED !== "1") {
    return denied(access.role, "maintenance.verify.service-admin");
  }

  const context = (dependencies.createContext ?? createAuditContext)(access);
  if (smoke) {
    return (dependencies.smokeHandler ?? handleMaintenanceVerificationSmokeRequest)(request, env, context);
  }
  return (dependencies.handler ?? handleMaintenanceControlRequest)(request, env, context);
}
