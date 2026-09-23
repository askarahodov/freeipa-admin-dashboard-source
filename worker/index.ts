/** Thin compatibility tail for framework dispatch during #635. */
import { handleFrameworkRequest } from "./framework-http-entry.ts";
import type { FrameworkHttpContext, FrameworkHttpEnv } from "./framework-http.ts";

export { allowedOperations, automationRoutes, resolveCatalogRuntime } from "./xyops-admin-runtime.ts";

/**
 * Compatibility typing surface for downstream adapters that still infer their
 * environment from the historical central default export. This type carries no
 * route or domain ownership in this module and is removed with the final tail.
 */
interface Env extends FrameworkHttpEnv {
  DB?: D1Database;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_VERIFY_TLS?: string;
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  XYOPS_EVENT_ID?: string;
  XYOPS_ROUTES_JSON?: string;
  XYOPS_RESULT_FILE_MAX_BYTES?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  ADMIN_TOKEN?: string;
  DEMO_MODE?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  PORTAL_CATALOG_POLICIES_JSON?: string;
  PORTAL_APPROVAL_POLICIES_JSON?: string;
  PORTAL_PROCESS_METADATA_JSON?: string;
}

type ExecutionContext = FrameworkHttpContext;

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const runtimeEnv = env ?? (process.env as unknown as Env);
    return handleFrameworkRequest(request, runtimeEnv, ctx);
  },
};

export default worker;
