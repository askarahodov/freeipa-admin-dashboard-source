export type PortalSecurityCompatibilityLayer = Readonly<{
  id:
    | "maintenance-recovery"
    | "service-admin-authentication"
    | "pre-session-route-guards"
    | "local-session-and-origin"
    | "settings-context-adaptation"
    | "canonical-request-context"
    | "downstream-authorization-audit";
  owner: string;
  responsibility: string;
}>;

/**
 * Current security-relevant traversal order for the compatibility runtime.
 *
 * This is deliberately an ownership/composition contract, not a second route or
 * permission registry. The listed layers describe where enforcement still
 * lives while #629 migrates those responsibilities around the canonical request
 * context. Route-specific handlers may retain additional authorization/audit
 * checks until their later domain extraction phase.
 */
export const portalSecurityCompatibilityOrder: readonly PortalSecurityCompatibilityLayer[] = Object.freeze([
  Object.freeze({
    id: "maintenance-recovery",
    owner: "worker/maintenance-mode-root-entry.ts",
    responsibility: "fail-closed maintenance and recovery reachability gate",
  }),
  Object.freeze({
    id: "service-admin-authentication",
    owner: "worker/service-admin-root-entry.ts",
    responsibility: "local-mode service-admin token authentication and compatibility identity adaptation",
  }),
  Object.freeze({
    id: "pre-session-route-guards",
    owner: "worker compatibility route wrappers",
    responsibility: "maintenance/backup/session/diagnostics and other route-specific compatibility guards",
  }),
  Object.freeze({
    id: "local-session-and-origin",
    owner: "worker/local-secure-entry.ts",
    responsibility: "local-session authentication plus same-origin protection for privileged local-admin mutations",
  }),
  Object.freeze({
    id: "settings-context-adaptation",
    owner: "worker/settings-*-entry.ts",
    responsibility: "effective settings/source and execution-context compatibility adaptation",
  }),
  Object.freeze({
    id: "canonical-request-context",
    owner: "worker/secure-entry.ts",
    responsibility: "trusted identity sanitization and canonical resolved request-context construction",
  }),
  Object.freeze({
    id: "downstream-authorization-audit",
    owner: "worker/index.ts and route-specific handlers",
    responsibility: "remaining route-specific authorization, audit and domain dispatch checks",
  }),
]);

export type PortalSecurityRuntime<Env, Context, ScheduledController> = Readonly<{
  fetch(request: Request, env: Env, ctx: Context): Promise<Response>;
  scheduled(controller: ScheduledController, env: Env | undefined, ctx: Context): Promise<void> | void;
}>;

/**
 * Named security composition seam used by the explicit application router.
 *
 * Checkpoint 1 is intentionally transparent: it delegates to the existing
 * compatibility runtime without reordering enforcement. Later #629 slices can
 * replace individual compatibility responsibilities behind this seam only
 * after parity/negative evidence exists.
 */
export function createPortalSecurityComposition<Env, Context, ScheduledController>(
  runtime: PortalSecurityRuntime<Env, Context, ScheduledController>,
): PortalSecurityRuntime<Env, Context, ScheduledController> {
  return Object.freeze({
    fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
      return runtime.fetch(request, env, ctx);
    },
    scheduled(controller: ScheduledController, env: Env | undefined, ctx: Context): Promise<void> | void {
      return runtime.scheduled(controller, env, ctx);
    },
  });
}
