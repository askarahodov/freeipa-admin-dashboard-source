import {
  portalRouteContracts,
  type PortalRouteContract,
  type PortalRouteMethod,
} from "./portal-route-contract.ts";

export type PortalRouteMatch = Readonly<{
  contract: PortalRouteContract;
  params: Readonly<Record<string, string>>;
}>;

type CompiledRoute = Readonly<{
  contract: PortalRouteContract;
  segments: readonly string[];
  staticSegments: number;
}>;

function pathSegments(path: string): readonly string[] | null {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) return null;
  if (path === "/") return [];
  return path.slice(1).split("/");
}

const compiledRoutes: readonly CompiledRoute[] = portalRouteContracts
  .map((contract) => {
    const segments = pathSegments(contract.path) ?? [];
    return Object.freeze({
      contract,
      segments,
      staticSegments: segments.filter((segment) => !segment.startsWith(":")).length,
    });
  })
  .sort((left, right) => {
    if (right.staticSegments !== left.staticSegments) return right.staticSegments - left.staticSegments;
    return right.segments.length - left.segments.length;
  });

function matchSegments(pattern: readonly string[], actual: readonly string[]): Readonly<Record<string, string>> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const value = actual[index];
    if (expected.startsWith(":")) {
      if (!value) return null;
      params[expected.slice(1)] = value;
      continue;
    }
    if (expected !== value) return null;
  }
  return Object.freeze(params);
}

/**
 * Resolves request metadata from the canonical route contract without invoking
 * a handler. Runtime dispatch remains unchanged until parity is proven.
 */
export function matchPortalRoute(method: PortalRouteMethod, pathname: string): PortalRouteMatch | undefined {
  const actual = pathSegments(pathname);
  if (!actual) return undefined;

  for (const route of compiledRoutes) {
    if (route.contract.method !== method) continue;
    const params = matchSegments(route.segments, actual);
    if (params) return Object.freeze({ contract: route.contract, params });
  }
  return undefined;
}
