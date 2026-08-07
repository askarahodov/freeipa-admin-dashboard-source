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
  conditionalPermissions?: readonly PortalPermission[];
  mutation: PortalRouteMutation;
  /**
   * True when the current local-admin/browser mutation path is protected by
   * the shared same-origin guard. Explicit service-admin token authorization
   * remains a separate trust mechanism and is not modeled as cookie CSRF.
   */
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
  {
    id: "settings.read",
    method: "GET",
    path: "/api/integrations/settings",
    owner: "worker/index.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "settings.update",
    method: "PUT",
    path: "/api/integrations/settings",
    owner: "worker/settings-source-safe-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "mutation",
    sameOrigin: true,
  },
  {
    id: "settings.test",
    method: "POST",
    path: "/api/integrations/settings/test",
    owner: "worker/index.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "mutation",
    sameOrigin: true,
  },
  {
    id: "settings.effective",
    method: "GET",
    path: "/api/integrations/settings/effective",
    owner: "worker/settings-lifecycle-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "settings.drafts.create",
    method: "POST",
    path: "/api/integrations/settings/drafts",
    owner: "worker/settings-lifecycle-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "mutation",
    sameOrigin: true,
  },
  {
    id: "settings.drafts.read",
    method: "GET",
    path: "/api/integrations/settings/drafts/:draftId",
    owner: "worker/settings-lifecycle-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "settings.drafts.validate",
    method: "POST",
    path: "/api/integrations/settings/drafts/:draftId/validate",
    owner: "worker/settings-lifecycle-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "mutation",
    sameOrigin: true,
  },
  {
    id: "settings.drafts.apply",
    method: "POST",
    path: "/api/integrations/settings/drafts/:draftId/apply",
    owner: "worker/settings-lifecycle-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "mutation",
    sameOrigin: true,
  },
  {
    id: "settings.drafts.cancel",
    method: "POST",
    path: "/api/integrations/settings/drafts/:draftId/cancel",
    owner: "worker/settings-lifecycle-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "mutation",
    sameOrigin: true,
  },
  {
    id: "settings.revisions.list",
    method: "GET",
    path: "/api/integrations/settings/revisions",
    owner: "worker/settings-revisions-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "settings.revisions.read",
    method: "GET",
    path: "/api/integrations/settings/revisions/:revision",
    owner: "worker/settings-revisions-entry.ts",
    auth: "admin-or-service-admin",
    permission: "settings.manage",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "freeipa.users.list",
    method: "GET",
    path: "/api/integrations/users",
    owner: "worker/index.ts",
    auth: "local-session",
    permission: "directory.read",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "freeipa.users.export",
    method: "GET",
    path: "/api/integrations/users/export.csv",
    owner: "worker/freeipa-user-bulk-entry.ts",
    auth: "local-session",
    permission: "directory.read",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "freeipa.groups.list",
    method: "GET",
    path: "/api/integrations/groups",
    owner: "worker/index.ts",
    auth: "local-session",
    permission: "directory.read",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "freeipa.groups.members",
    method: "GET",
    path: "/api/integrations/groups/members",
    owner: "worker/freeipa-group-member-entry.ts",
    auth: "local-session",
    permission: "directory.read",
    mutation: "read",
    sameOrigin: false,
  },
  {
    id: "freeipa.actions",
    method: "POST",
    path: "/api/integrations/freeipa/actions",
    owner: "worker/index.ts",
    auth: "local-session",
    permission: "freeipa.write",
    conditionalPermissions: ["freeipa.delete"],
    mutation: "mutation",
    sameOrigin: false,
  },
  {
    id: "freeipa.bulk",
    method: "POST",
    path: "/api/integrations/freeipa/bulk",
    owner: "worker/freeipa-user-bulk-entry.ts",
    auth: "local-session",
    permission: "freeipa.write",
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
