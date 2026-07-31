import { createAuditContext, type AuditContext } from "../audit-log.ts";
import {
  encryptedBackupAccess,
  type EncryptedBackupAccess,
  type EncryptedBackupAccessEnv,
} from "./backup-encrypted-root-entry.ts";
import {
  handleSelectiveBackupRestoreRequest,
  SELECTIVE_RESTORE_CANCEL_PATH,
  SELECTIVE_RESTORE_COMMIT_PATH,
  SELECTIVE_RESTORE_PREPARE_PATH,
} from "./backup-selective-restore-entry.ts";

export type SelectiveBackupRuntimeEnv = EncryptedBackupAccessEnv & Record<string, unknown>;

export type SelectiveBackupDispatchDependencies = {
  prepareHandler?: typeof handleSelectiveBackupRestoreRequest;
  commitHandler?: typeof handleSelectiveBackupRestoreRequest;
  cancelHandler?: typeof handleSelectiveBackupRestoreRequest;
  createContext?: (access: EncryptedBackupAccess) => AuditContext;
};

function denied(requiredPermission: string, role: EncryptedBackupAccess["role"]): Response {
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

export async function handleSelectiveBackupRoute(
  request: Request,
  env: SelectiveBackupRuntimeEnv,
  dependencies: SelectiveBackupDispatchDependencies = {},
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== SELECTIVE_RESTORE_PREPARE_PATH
      && pathname !== SELECTIVE_RESTORE_COMMIT_PATH
      && pathname !== SELECTIVE_RESTORE_CANCEL_PATH) return null;

  const access = encryptedBackupAccess(request, env);
  const requiredPermission = pathname === SELECTIVE_RESTORE_PREPARE_PATH
    ? "backup.restore.prepare"
    : pathname === SELECTIVE_RESTORE_COMMIT_PATH
      ? "backup.restore.commit"
      : "backup.restore.cancel";
  if (access.role !== "admin") return denied(requiredPermission, access.role);

  const context = (dependencies.createContext ?? createAuditContext)(access);
  if (pathname === SELECTIVE_RESTORE_PREPARE_PATH) {
    return (dependencies.prepareHandler ?? handleSelectiveBackupRestoreRequest)(request, env, context);
  }
  if (pathname === SELECTIVE_RESTORE_COMMIT_PATH) {
    return (dependencies.commitHandler ?? handleSelectiveBackupRestoreRequest)(request, env, context);
  }
  return (dependencies.cancelHandler ?? handleSelectiveBackupRestoreRequest)(request, env, context);
}
