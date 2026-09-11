import compatibilityRuntime from "./maintenance-mode-root-entry.ts";
import { handleStorageMigrationApplyRequest } from "./storage-migration-apply-entry.ts";
import { handleStorageMigrationApplyGate } from "./middleware/storage-migration-apply.ts";

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
 * `storage-migration-apply` is the first gate executed explicitly here. It
 * preserves the legacy outer order by short-circuiting controlled migration
 * requests before maintenance and delegating all other traffic unchanged to
 * the remaining compatibility graph. Subsequent gates stay compatibility-
 * owned until their behavior is captured by focused parity/negative tests.
 */
const securityComposition = {
  fetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
    return handleStorageMigrationApplyGate(request, env, ctx, {
      handleApply: handleStorageMigrationApplyRequest,
      nextFetch: (nextRequest, nextEnv, nextContext) => compatibilityRuntime.fetch(nextRequest, nextEnv, nextContext),
    });
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return compatibilityRuntime.scheduled?.(controller, env, ctx);
  },
};

export default securityComposition;
