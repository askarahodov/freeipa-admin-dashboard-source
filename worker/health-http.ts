import { ensurePortalSchema } from "../db/portal-migrations-hardened.ts";
import { matchPortalRoute } from "../src/auth/portal-route-router.ts";
import {
  resolvePortalApplicationRoute,
  type PortalApplicationRoute,
} from "./application-router.ts";
import { handleDependencyHealthRequest } from "./dependency-health.ts";
import { handleHealthRequest } from "./health-contracts.ts";
import { handleHealthDiagnosticsRequest } from "./health-diagnostics-ui.ts";
import { handleHealthMetricsRequest } from "./health-metrics.ts";

export type HealthHttpEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  PORTAL_BUILD_VERSION?: string;
};

const stableHealthRouteIds = new Set([
  "health.live",
  "health.ready",
  "integration.health.compat",
]);

const supplementalHealthSurfaces = new Set([
  "dependency-health",
  "health-diagnostics",
  "health-diagnostics-asset",
  "health-metrics",
]);

function stableHealthRouteForPath(pathname: string): boolean {
  const match = matchPortalRoute("GET", pathname);
  return Boolean(match && stableHealthRouteIds.has(match.contract.id));
}

/**
 * Returns true only for infrastructure health/diagnostics classifications that
 * intentionally remain reachable before the ordinary schema/security graph.
 *
 * The decision consumes the same canonical application classification used by
 * `application.ts`; it does not maintain a second method/path registry.
 */
export function isHealthApplicationRoute(route: PortalApplicationRoute): boolean {
  if (route.kind === "stable") return stableHealthRouteIds.has(route.match.contract.id);
  if (route.kind === "method-not-allowed") return stableHealthRouteForPath(route.pathname);
  if (route.kind === "supplemental") return supplementalHealthSurfaces.has(route.surface);
  return false;
}

/**
 * Schema composition uses this predicate only to preserve the historical
 * pre-schema pass-through. Actual HTTP dispatch is owned by this adapter from
 * the explicit application router.
 */
export function isPreSchemaHealthApplicationRequest(request: Request): boolean {
  return isHealthApplicationRoute(resolvePortalApplicationRoute(request));
}

async function portalSchema(env: HealthHttpEnv) {
  return await ensurePortalSchema(env);
}

async function canonicalHealthResponse(request: Request, env: HealthHttpEnv): Promise<Response | null> {
  return await handleHealthRequest(request, env, {
    portalSchema,
    fetchImpl: fetch,
  });
}

/**
 * Single HTTP adapter for the public/infrastructure health surface.
 *
 * Handler order intentionally preserves the former pre-schema dispatch:
 * stable health -> dependency health -> sanitized diagnostics UI/assets ->
 * metrics. Metrics evaluate only the stable live/ready contract and do not
 * trigger the external dependency-health probe.
 */
export async function handleHealthApplicationRoute(
  request: Request,
  env: HealthHttpEnv,
  route: PortalApplicationRoute,
): Promise<Response | null> {
  if (!isHealthApplicationRoute(route)) return null;

  const healthResponse = await canonicalHealthResponse(request, env);
  if (healthResponse) return healthResponse;

  const dependencyHealthResponse = await handleDependencyHealthRequest(request, env, {
    portalSchema,
    fetchImpl: fetch,
  });
  if (dependencyHealthResponse) return dependencyHealthResponse;

  const diagnosticsResponse = await handleHealthDiagnosticsRequest(request);
  if (diagnosticsResponse) return diagnosticsResponse;

  return await handleHealthMetricsRequest(request, env, {
    healthHandler: async (healthRequest) => {
      const response = await canonicalHealthResponse(healthRequest, env);
      if (!response) throw new Error("Internal health route was not handled");
      return response;
    },
  });
}
