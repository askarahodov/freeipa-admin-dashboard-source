/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleFrameworkRequest } from "./framework-http-entry.ts";
import type { FrameworkHttpContext, FrameworkHttpEnv } from "./framework-http.ts";
export { allowedOperations, automationRoutes, resolveCatalogRuntime } from "./xyops-admin-runtime.ts";

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

    return handleFrameworkRequest(request, runtimeEnv, ctx);
  },
};

async function readCatalogSnapshot(env: Env): Promise<CatalogSnapshot | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT catalog_json, synced_at FROM xyops_catalog_snapshot WHERE id = ?"