import type {
  PortalRouteAuthBoundary,
  PortalRouteContract,
} from "./portal-route-contract.ts";

export type PortalRouteSecurityStage =
  | "request-context"
  | "authentication"
  | "authorization"
  | "same-origin";

export type PortalRouteSecurityPlan = Readonly<{
  routeId: string;
  auth: PortalRouteAuthBoundary;
  permission?: PortalRouteContract["permission"];
  conditionalPermissions: readonly NonNullable<PortalRouteContract["conditionalPermissions"]>[number][];
  requiredRole?: PortalRouteContract["requiredRole"];
  mutation: PortalRouteContract["mutation"];
  sameOrigin: boolean;
  stages: readonly PortalRouteSecurityStage[];
}>;

/**
 * Builds the ordered security middleware plan described by the canonical route
 * registry. It does not authenticate, authorize, dispatch, or emit audit events.
 * Runtime wrappers remain authoritative until the #56 parity cutover.
 */
export function portalRouteSecurityPlan(contract: Readonly<PortalRouteContract>): PortalRouteSecurityPlan {
  const stages: PortalRouteSecurityStage[] = ["request-context"];

  if (contract.auth !== "public") {
    stages.push("authentication", "authorization");
  }
  if (contract.sameOrigin) stages.push("same-origin");

  return Object.freeze({
    routeId: contract.id,
    auth: contract.auth,
    permission: contract.permission,
    conditionalPermissions: Object.freeze([...(contract.conditionalPermissions ?? [])]),
    requiredRole: contract.requiredRole,
    mutation: contract.mutation,
    sameOrigin: contract.sameOrigin,
    stages: Object.freeze(stages),
  });
}
