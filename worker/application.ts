import compatibilityRuntime from "./maintenance-mode-root-entry.ts";
import {
  createPortalApplicationRouter,
  finalizePortalApplicationResponse,
} from "./application-router.ts";

type RuntimeEnv = NonNullable<Parameters<typeof compatibilityRuntime.fetch>[1]>;
type RuntimeContext = Parameters<typeof compatibilityRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

function compatibilityFetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
  return compatibilityRuntime.fetch(request, env, ctx);
}

const router = createPortalApplicationRouter<RuntimeEnv, RuntimeContext>({
  stable: ({ request, env, ctx }) => compatibilityFetch(request, env, ctx),
  negative: async ({ request, env, ctx, route }) => {
    const response = await compatibilityFetch(request, env, ctx);
    return finalizePortalApplicationResponse(route, response);
  },
  supplemental: ({ request, env, ctx }) => compatibilityFetch(request, env, ctx),
  framework: ({ request, env, ctx }) => compatibilityFetch(request, env, ctx),
});

/**
 * Explicit Worker application composition boundary.
 *
 * HTTP requests are classified through canonical route metadata and dispatched
 * through explicit stable/negative/supplemental/framework registrations. All
 * four registrations still use the existing maintenance/security/domain
 * compatibility runtime, so security and stable-route handler behavior remain
 * unchanged. Only the negative registration finalizes an already-returned
 * matching 404/405 envelope after compatibility security/status handling.
 *
 * Scheduled execution is intentionally delegated unchanged; its schema and
 * maintenance gates remain owned by the existing runtime until the final
 * scheduled/assets cleanup phase.
 */
const application = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    return router.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return compatibilityRuntime.scheduled?.(controller, env, ctx);
  },
};

export default application;
