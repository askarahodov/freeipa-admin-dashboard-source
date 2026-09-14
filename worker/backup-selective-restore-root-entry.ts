import rootRuntime from "./session-management-entry.ts";
import {
  handleSelectiveBackupRoute,
  type SelectiveBackupRuntimeEnv,
} from "./backup-selective-restore-dispatch.ts";
import {
  handleBackupImportPreviewRoute,
  type BackupPreviewAccessEnv,
} from "./backup-import-preview-root-entry.ts";
import {
  handleEncryptedBackupRoute,
  type EncryptedBackupAccessEnv,
} from "./backup-encrypted-root-entry.ts";

export { handleSelectiveBackupRoute } from "./backup-selective-restore-dispatch.ts";
export type { SelectiveBackupDispatchDependencies } from "./backup-selective-restore-dispatch.ts";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]>
  & SelectiveBackupRuntimeEnv
  & BackupPreviewAccessEnv
  & EncryptedBackupAccessEnv;
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const selectiveResponse = await handleSelectiveBackupRoute(request, sourceEnv);
    if (selectiveResponse) return selectiveResponse;
    const encryptedBackupResponse = await handleEncryptedBackupRoute(request, sourceEnv);
    if (encryptedBackupResponse) return encryptedBackupResponse;
    const previewResponse = await handleBackupImportPreviewRoute(request, sourceEnv);
    if (previewResponse) return previewResponse;
    return rootRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return rootRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
