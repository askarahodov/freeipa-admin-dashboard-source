import rootRuntime from "./freeipa-group-member-entry.ts";
import {
  handleSelectiveBackupRoute,
  type SelectiveBackupRuntimeEnv,
} from "./backup-selective-restore-dispatch.ts";

export { handleSelectiveBackupRoute } from "./backup-selective-restore-dispatch.ts";
export type { SelectiveBackupDispatchDependencies } from "./backup-selective-restore-dispatch.ts";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & SelectiveBackupRuntimeEnv;
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const selectiveResponse = await handleSelectiveBackupRoute(request, sourceEnv);
    if (selectiveResponse) return selectiveResponse;
    return rootRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return rootRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
