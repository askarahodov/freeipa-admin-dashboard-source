import rootRuntime from "./schema-migrations-entry.ts";
import { applyHttpSecurityHeaders } from "../scripts/http-security.mjs";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & {
  PORTAL_CSP_MODE?: string;
  PORTAL_HSTS_ENABLED?: string;
};
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const response = await rootRuntime.fetch(request, sourceEnv, ctx);
    return applyHttpSecurityHeaders(request, response, sourceEnv);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return rootRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
