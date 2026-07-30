import runtime, { authorizeSettingsMutation } from "./settings-source-safe-entry";

type RuntimeEnv = NonNullable<Parameters<typeof runtime.fetch>[1]>;
type RuntimeContext = Parameters<typeof runtime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof runtime.scheduled>>[0];

function safeContext(ctx: RuntimeContext): RuntimeContext {
  if (typeof ctx?.waitUntil === "function") return ctx;
  return {
    ...(ctx as object),
    waitUntil(promise: Promise<unknown>) {
      void Promise.resolve(promise).catch(() => {});
    },
    passThroughOnException() {},
  } as RuntimeContext;
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    return runtime.fetch(request, env, safeContext(ctx));
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return runtime.scheduled?.(controller, env, safeContext(ctx));
  },
};

export { authorizeSettingsMutation };
export default worker;
