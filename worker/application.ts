import compatibilityRuntime from "./maintenance-mode-root-entry.ts";
import {
  createPortalApplicationRouter,
  finalizePortalApplicationResponse,
} from "./application-router.ts";

type RuntimeEnv = NonNullable<Parameters<typeof compatibilityRuntime.fetch>[1]>;
type RuntimeContext = Parameters<typeof compatibilityRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

const router = createPortalApplicationRouter<RuntimeEnv, RuntimeContext>(
  async ({ request, env, ctx, route }) => {
    const response = await compatibilityRuntime.fetch(request, env, ctx);
    return finalizePortalApplicationResponse(route, response);
  },
);

/**
 * Explicit Worker application composition boundary.
 *
 * HTTP requests are classified through the canonical route matcher before the
 * existing maintenance/security/domain wrapper graph executes. The compatibility
 * runtime remains authoritative for security and stable-route handlers. For
 * negative classifications, the application owns only the final 404/405 JSON
 * envelope after the compatibility runtime has already returned that status;
 * security/maintenance denials are never promoted to routing errors.
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
