import rootRuntime from "./settings-input-normalizer-entry.ts";
import { handleStorageStatusRequest } from "./storage-status-entry.ts";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]>
  & Parameters<typeof handleStorageStatusRequest>[1];
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const storageResponse = await handleStorageStatusRequest(request, sourceEnv);
    if (storageResponse) return storageResponse;
    return rootRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return rootRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
