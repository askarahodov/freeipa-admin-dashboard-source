import {
  isAdminIntegrationPath,
  serviceAdminTokenAuthorized,
} from "../../src/auth/admin-session-authorization.ts";

export type ServiceAdminRuntimeEnv = {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  PORTAL_SERVICE_ADMIN_AUTHORIZED?: string;
  ADMIN_TOKEN?: string;
};

export type ServiceAdminAuthenticationGateDependencies<RuntimeEnv, RuntimeContext> = Readonly<{
  nextFetch: (request: Request, env: RuntimeEnv, ctx: RuntimeContext) => Promise<Response>;
}>;

function localMode(env: ServiceAdminRuntimeEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

function serviceAdminEnv<RuntimeEnv extends ServiceAdminRuntimeEnv>(env: RuntimeEnv): RuntimeEnv {
  const identity = "service-admin@portal.local";
  return {
    ...env,
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_STATIC_NAME: "Service administrator",
    PORTAL_DEFAULT_ROLE: "admin",
    PORTAL_RBAC_JSON: JSON.stringify({ [identity]: "admin" }),
    PORTAL_SERVICE_ADMIN_AUTHORIZED: "1",
  } as RuntimeEnv;
}

/**
 * Explicit outer service-admin authentication/adaptation gate.
 *
 * This preserves the legacy wrapper contract exactly: only local-mode requests
 * on the canonical administrative integration allowlist may be adapted, and
 * only after constant-time ADMIN_TOKEN authorization. Unauthorized or
 * non-allowlisted traffic delegates with the original request, environment and
 * runtime-context object identities. Authorized traffic preserves request and
 * context identity while deriving the same synthetic service-admin environment
 * used by the compatibility wrapper.
 */
export async function handleServiceAdminAuthenticationGate<
  RuntimeEnv extends ServiceAdminRuntimeEnv,
  RuntimeContext,
>(
  request: Request,
  env: RuntimeEnv,
  ctx: RuntimeContext,
  dependencies: ServiceAdminAuthenticationGateDependencies<RuntimeEnv, RuntimeContext>,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    localMode(env)
    && isAdminIntegrationPath(url.pathname)
    && await serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)
  ) {
    return dependencies.nextFetch(request, serviceAdminEnv(env), ctx);
  }
  return dependencies.nextFetch(request, env, ctx);
}
