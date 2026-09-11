import {
  isAdminIntegrationPath,
  serviceAdminTokenAuthorized,
} from "../../src/auth/admin-session-authorization.ts";

export type ServiceAdminCompatibilityEnv = {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  PORTAL_SERVICE_ADMIN_AUTHORIZED?: string;
  ADMIN_TOKEN?: string;
};

function localMode(env: ServiceAdminCompatibilityEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

export function serviceAdminCompatibilityEnv<Env extends ServiceAdminCompatibilityEnv>(env: Env): Env {
  const identity = "service-admin@portal.local";
  return {
    ...env,
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_STATIC_NAME: "Service administrator",
    PORTAL_DEFAULT_ROLE: "admin",
    PORTAL_RBAC_JSON: JSON.stringify({ [identity]: "admin" }),
    PORTAL_SERVICE_ADMIN_AUTHORIZED: "1",
  };
}

/**
 * Resolve the existing service-admin compatibility adaptation without changing
 * the trust boundary: only local identity mode, allowlisted admin integration
 * paths and a matching configured token may produce an adapted environment.
 *
 * Returning null means the caller must continue with the original environment.
 */
export async function resolveServiceAdminCompatibilityEnv<Env extends ServiceAdminCompatibilityEnv>(
  request: Request,
  env: Env,
): Promise<Env | null> {
  if (!localMode(env)) return null;
  if (!isAdminIntegrationPath(new URL(request.url).pathname)) return null;
  if (!await serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)) return null;
  return serviceAdminCompatibilityEnv(env);
}
