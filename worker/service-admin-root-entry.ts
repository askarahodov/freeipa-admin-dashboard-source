import rootRuntime from "./freeipa-group-member-entry";
import { isAdminIntegrationPath, serviceAdminTokenAuthorized } from "../admin-session-authorization";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  ADMIN_TOKEN?: string;
};
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

function localMode(env: RuntimeEnv): boolean {
  return String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
}

function serviceAdminEnv(env: RuntimeEnv): RuntimeEnv {
  const identity = "service-admin@portal.local";
  return {
    ...env,
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_STATIC_NAME: "Service administrator",
    PORTAL_DEFAULT_ROLE: "admin",
    PORTAL_RBAC_JSON: JSON.stringify({ [identity]: "admin" }),
  };
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);
    if (
      localMode(sourceEnv)
      && isAdminIntegrationPath(url.pathname)
      && await serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)
    ) {
      return rootRuntime.fetch(request, serviceAdminEnv(sourceEnv), ctx);
    }
    return rootRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return rootRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
