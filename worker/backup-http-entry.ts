import runtime from "./freeipa-http-entry.ts";
import {
  handleBackupHttpRequest,
  type BackupHttpEnv,
} from "./backup-http.ts";

type RuntimeEnv = NonNullable<Parameters<typeof runtime.fetch>[1]> & BackupHttpEnv;
type RuntimeContext = Parameters<typeof runtime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof runtime.scheduled>>[0];

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const response = await handleBackupHttpRequest(request, sourceEnv);
    if (response) return response;
    return runtime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return runtime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
