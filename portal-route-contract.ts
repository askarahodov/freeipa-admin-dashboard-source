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
  {
    id: "auth.session",
    method: "GET",
    path: "/api/auth/session",
    owner: "worker/local-secure-entry.ts",
    auth: "public",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "auth.login",
    method: "POST",
    path: "/api/auth/login",
    owner: "worker/local-secure-entry.ts",
    auth: "public",
    mutation: "mutation",
    sameOrigin: false,
  },
  {
    id: "auth.logout",
    method: "POST",
    path: "/api/auth/logout",
    owner: "worker/local-secure-entry.ts",
    auth: "local-session",
    mutation: "mutation",
    sameOrigin: false,
  },
  {
    id: "auth.users.list",
    method: "GET",
    path: "/api/auth/users",
    owner: "worker/local-secure-entry.ts",
    auth: "admin-session",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "auth.users.create",
    method: "POST",
    path: "/api/auth/users",
    owner: "worker/local-secure-entry.ts",
    auth: "admin-session",
    mutation: "mutation",
    sameOrigin: false,
  },
  {
    id: "auth.users.update",
    method: "PUT",
    path: "/api/auth/users/:userId",
    owner: "worker/local-secure-entry.ts",
    auth: "admin-session",
    mutation: "mutation",
    sameOrigin: false,
  },
  {
    id: "auth.users.delete",
    method: "DELETE",
    path: "/api/auth/users/:userId",
    owner: "worker/local-secure-entry.ts",
    auth: "admin-session",
    mutation: "mutation",
    sameOrigin: false,
  },
  {
    id: "auth.users.password-reset",
    method: "POST",
    path: "/api/auth/users/:userId/password",
    owner: "worker/local-secure-entry.ts",
    auth: "admin-session",
    mutation: "mutation",
    sameOrigin: false,
  },
  {
    id: "auth.users.sessions-revoke",
    method: "DELETE",
    path: "/api/auth/users/:userId/sessions",
    owner: "worker/local-secure-entry.ts",
    auth: "admin-session",
    mutation: "mutation",
    sameOrigin: false,
  },
] as const satisfies readonly PortalRouteContract[];

export function findPortalRouteContract(
  method: PortalRouteMethod,
  path: string,
): PortalRouteContract | undefined {
  return portalRouteContracts.find((route) => route.method === method && route.path === path);
}
