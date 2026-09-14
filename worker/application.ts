import securityComposition from "./security-composition.ts";
import {
  createPortalApplicationRouter,
  finalizePortalApplicationResponse,
} from "./application-router.ts";
import { handleHealthApplicationRoute } from "./health-http.ts";

type RuntimeEnv = NonNullable<Parameters<typeof securityComposition.fetch>[1]>;
type RuntimeContext = Parameters<typeof securityComposition.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof securityComposition.scheduled>>[0];

function compatibilityFetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
  return securityComposition.fetch(request, env, ctx);
}

async function healthOrCompatibility(
  request: Request,
  env: RuntimeEnv,
  ctx: RuntimeContext,
  route: Parameters<typeof handleHealthApplicationRoute>[2],
): Promise<Response> {
  const healthResponse = await handleHealthApplicationRoute(request, env, route);
  return healthResponse ?? compatibilityFetch(request, env, ctx);
}

const router = createPortalApplicationRouter<RuntimeEnv, RuntimeContext>({
  stable: ({ request, env, ctx, route }) => healthOrCompatibility(request, env, ctx, route),
  negative: async ({ request, env, ctx, route }) => {
    const healthResponse = await handleHealthApplicationRoute(request, env, route);
    if (healthResponse) return healthResponse;
    const response = await compatibilityFetch(request, env, ctx);
    return finalizePortalApplicationResponse(route, response);
  },
  supplemental: ({ request, env, ctx, route }) => healthOrCompatibility(request, env, ctx, route),
  framework: ({ request, env, ctx }) => compatibilityFetch(request, env, ctx),
});

/**
 * Explicit Worker application composition boundary.
 *
 * HTTP requests are classified through canonical route metadata and dispatched
 * through explicit stable/negative/supplemental/framework registrations.
 * Infrastructure health classifications are the first domain extraction: the
 * schema boundary preserves their historical pre-schema pass-through and this
 * composition delegates them to one `health-http.ts` owner before security.
 * All other registrations still enter the compatibility security composition.
 *
 * For non-health negative classifications only, the application finalizes an
 * already-returned matching 404/405 envelope after compatibility
 * security/status handling.
 *
 * Scheduled execution is intentionally delegated unchanged; its schema and
 * maintenance gates remain compatibility-owned until the final cleanup phase.
 */
const application = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    return router.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return securityComposition.scheduled?.(controller, env, ctx);
  },
};

export default application;
