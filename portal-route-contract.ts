import type { PortalPermission } from "./portal-permissions.ts";

export type PortalRouteMethod = "GET" | "POST" | "PUT" | "DELETE";

export type PortalRouteAuthBoundary =
  | "public"
  | "local-session"
  | "admin-session"
  | "service-admin"
  | "admin-or-service-admin";

export type PortalRouteMutation = "read" | "mutation";

export type PortalRouteContract = {
  id: string;
  method: PortalRouteMethod;
  path: string;
  owner: string;
  auth: PortalRouteAuthBoundary;
  permission?: PortalPermission;
  mutation: PortalRouteMutation;
  sameOrigin: boolean;
  errorOwner?: string;
};

export const portalRouteContracts = [
  {
    id: "health.live",
    method: "GET",
    path: "/health/live",
    owner: "worker/health-contracts.ts",
    auth: "public",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "health.ready",
    method: "GET",
    path: "/health/ready",
    owner: "worker/health-contracts.ts",
    auth: "public",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "schema.status",
    method: "GET",
    path: "/api/schema/status",
    owner: "worker/schema-migrations-entry.ts",
    auth: "service-admin",
    mutation: "read",
    sameOrigin: false,
  },
] as const satisfies readonly PortalRouteContract[];

export function findPortalRouteContract(
  method: PortalRouteMethod,
  path: string,
): PortalRouteContract | undefined {
  return portalRouteContracts.find((route) => route.method === method && route.path === path);
}
