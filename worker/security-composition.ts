import compatibilityRuntime from "./maintenance-mode-root-entry.ts";

export {
  portalAuthenticationMechanisms,
  portalLocalSecurityOrderProfiles,
  portalSecurityGateOrder,
} from "./security-composition-contract.ts";
export type {
  PortalAuthenticationMechanism,
  PortalLocalSecurityOrderProfile,
  PortalSecurityGateId,
} from "./security-composition-contract.ts";

type RuntimeEnv = NonNullable<Parameters<typeof compatibilityRuntime.fetch>[1]>;
type RuntimeContext = Parameters<typeof compatibilityRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

/**
 * Single application-facing security seam during the compatibility migration.
 *
 * The ordered migration metadata lives in security-composition-contract.ts so
 * tests can inspect it without loading this legacy runtime graph. Do not add
 * security behavior here merely to make that contract "real". Each gate is
 * cut over separately only after its current behavior is captured by focused
 * negative/parity tests. Until then this adapter preserves request/env/context
 * exactly and the legacy graph remains the execution authority.
 */
const securityComposition = {
  fetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
    return compatibilityRuntime.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return compatibilityRuntime.scheduled?.(controller, env, ctx);
  },
};

export default securityComposition;
