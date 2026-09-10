import compatibilityRuntime from "./maintenance-mode-root-entry.ts";
import { createPortalApplicationRouter } from "./application-router.ts";

type RuntimeEnv = NonNullable<Parameters<typeof compatibilityRuntime.fetch>[1]>;
type RuntimeContext = Parameters<typeof compatibilityRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

const router = createPortalApplicationRouter<RuntimeEnv, RuntimeContext>(
  async ({ request, env, ctx }) => compatibilityRuntime.fetch(request, env, ctx),
);

/**
 * Explicit Worker application composition boundary.
 *
 * HTTP requests are classified through the canonical route matcher before the
 * existing maintenance/security/domain wrapper graph executes unchanged. The
 * compatibility runtime remains authoritative for enforcement and handlers
 * until #628 parity work moves those responsibilities deliberately.
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
