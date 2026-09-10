import {
  matchPortalRoute,
  type PortalRouteMatch,
} from "../src/auth/portal-route-router.ts";
import type { PortalRouteMethod } from "../src/auth/portal-route-contract.ts";

const canonicalMethods = Object.freeze<readonly PortalRouteMethod[]>([
  "GET",
  "POST",
  "PUT",
  "DELETE",
]);

const supplementalSurfaceByPath = new Map<string, PortalSupplementalSurface>([
  ["/health/dependencies", "dependency-health"],
  ["/diagnostics/health", "health-diagnostics"],
  ["/diagnostics/health.js", "health-diagnostics-asset"],
  ["/diagnostics/health.css", "health-diagnostics-asset"],
  ["/metrics/health", "health-metrics"],
  ["/api/maintenance/status", "public-maintenance-status"],
  ["/_vinext/image", "vinext-image"],
]);

export type PortalSupplementalSurface =
  | "dependency-health"
  | "health-diagnostics"
  | "health-diagnostics-asset"
  | "health-metrics"
  | "public-maintenance-status"
  | "vinext-image";

export type PortalApplicationRoute =
  | Readonly<{
      kind: "stable";
      match: PortalRouteMatch;
      allowedMethods: readonly PortalRouteMethod[];
    }>
  | Readonly<{
      kind: "method-not-allowed";
      pathname: string;
      allowedMethods: readonly PortalRouteMethod[];
    }>
  | Readonly<{
      kind: "supplemental";
      pathname: string;
      surface: PortalSupplementalSurface;
    }>
  | Readonly<{
      kind: "unknown-api";
      pathname: string;
    }>
  | Readonly<{
      kind: "framework";
      pathname: string;
    }>;

export type PortalStableApplicationRoute = Extract<PortalApplicationRoute, { kind: "stable" }>;
export type PortalNegativeApplicationRoute =
  | Extract<PortalApplicationRoute, { kind: "method-not-allowed" }>
  | Extract<PortalApplicationRoute, { kind: "unknown-api" }>;
export type PortalSupplementalApplicationRoute = Extract<PortalApplicationRoute, { kind: "supplemental" }>;
export type PortalFrameworkApplicationRoute = Extract<PortalApplicationRoute, { kind: "framework" }>;

export type PortalApplicationHandlerInput<
  Env,
  Context,
  Route extends PortalApplicationRoute,
> = Readonly<{
  request: Request;
  env: Env;
  ctx: Context;
  route: Route;
}>;

export type PortalApplicationHandler<
  Env,
  Context,
  Route extends PortalApplicationRoute,
> = (
  input: PortalApplicationHandlerInput<Env, Context, Route>,
) => Promise<Response>;

export type PortalApplicationHandlers<Env, Context> = Readonly<{
  stable: PortalApplicationHandler<Env, Context, PortalStableApplicationRoute>;
  negative: PortalApplicationHandler<Env, Context, PortalNegativeApplicationRoute>;
  supplemental: PortalApplicationHandler<Env, Context, PortalSupplementalApplicationRoute>;
  framework: PortalApplicationHandler<Env, Context, PortalFrameworkApplicationRoute>;
}>;

function requestMethod(method: string): PortalRouteMethod | undefined {
  const normalized = method.toUpperCase();
  return canonicalMethods.includes(normalized as PortalRouteMethod)
    ? normalized as PortalRouteMethod
    : undefined;
}

function allowedMethodsForPath(pathname: string): readonly PortalRouteMethod[] {
  return Object.freeze(canonicalMethods.filter((method) => Boolean(matchPortalRoute(method, pathname))));
}

function negativeJsonResponse(response: Response, error: "Method not allowed" | "Not found"): Response {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.delete("content-length");
  return new Response(JSON.stringify({ error }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Resolves the HTTP application surface from canonical route metadata without
 * duplicating route patterns or changing current authorization/handler behavior.
 *
 * During #628 the stable/method/unknown decisions are consumed by the explicit
 * application composition while legacy wrappers remain the compatibility
 * dispatcher. Security and handler cutovers happen only after parity proof.
 */
export function resolvePortalApplicationRoute(request: Request): PortalApplicationRoute {
  const pathname = new URL(request.url).pathname;
  const method = requestMethod(request.method);
  if (method) {
    const match = matchPortalRoute(method, pathname);
    if (match) {
      return Object.freeze({
        kind: "stable",
        match,
        allowedMethods: allowedMethodsForPath(pathname),
      });
    }
  }

  const allowedMethods = allowedMethodsForPath(pathname);
  if (allowedMethods.length > 0) {
    return Object.freeze({
      kind: "method-not-allowed",
      pathname,
      allowedMethods,
    });
  }

  const supplemental = supplementalSurfaceByPath.get(pathname);
  if (supplemental) {
    return Object.freeze({
      kind: "supplemental",
      pathname,
      surface: supplemental,
    });
  }

  if (pathname.startsWith("/api/")) {
    return Object.freeze({ kind: "unknown-api", pathname });
  }

  return Object.freeze({ kind: "framework", pathname });
}

/**
 * Owns the outward negative API envelope only after the compatibility runtime
 * has performed its existing maintenance/auth/authorization checks.
 *
 * A route classification never promotes an arbitrary downstream response to
 * 404/405. Existing 401/403/409/429/5xx behavior therefore remains authoritative
 * until the security composition moves in #629. Stable, supplemental and
 * framework responses are always returned unchanged.
 */
export function finalizePortalApplicationResponse(
  route: PortalApplicationRoute,
  response: Response,
): Response {
  if (route.kind === "method-not-allowed" && response.status === 405) {
    return negativeJsonResponse(response, "Method not allowed");
  }
  if (route.kind === "unknown-api" && response.status === 404) {
    return negativeJsonResponse(response, "Not found");
  }
  return response;
}

/**
 * Creates the single HTTP application routing boundary with explicit dispatch
 * registration by route kind. Registrations are intentionally coarse-grained:
 * canonical route metadata stays the route source of truth, while individual
 * domain handlers can replace compatibility-backed registrations incrementally.
 */
export function createPortalApplicationRouter<Env, Context>(
  handlers: PortalApplicationHandlers<Env, Context>,
): Readonly<{
  fetch(request: Request, env: Env, ctx: Context): Promise<Response>;
}> {
  return Object.freeze({
    async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
      const route = resolvePortalApplicationRoute(request);
      switch (route.kind) {
        case "stable":
          return handlers.stable(Object.freeze({ request, env, ctx, route }));
        case "method-not-allowed":
        case "unknown-api":
          return handlers.negative(Object.freeze({ request, env, ctx, route }));
        case "supplemental":
          return handlers.supplemental(Object.freeze({ request, env, ctx, route }));
        case "framework":
          return handlers.framework(Object.freeze({ request, env, ctx, route }));
      }
    },
  });
}
