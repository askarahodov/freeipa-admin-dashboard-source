import compatibilityRuntime from "./service-admin-root-entry.ts";
import {
  handleMaintenanceGate,
  handleMaintenanceScheduledGate,
} from "./maintenance-mode-gate.ts";
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

type RuntimeEnv = NonNullable<Parameters<typeof compatibilityRuntime.fetch>[1]> & {
  DB?: D1Database;
};
type RuntimeContext = Parameters<typeof compatibilityRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

function maintenanceDependencies() {
  return {
    nextFetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
      return compatibilityRuntime.fetch(request, env, ctx);
    },
    nextScheduled(
      controller: ScheduledController,
      env: RuntimeEnv,
      ctx: RuntimeContext,
    ): Promise<void> | void {
      return compatibilityRuntime.scheduled?.(controller, env, ctx);
    },
  };
}

/**
 * Single application-facing security seam during the compatibility migration.
 *
 * `storage-migration-apply` and maintenance are executed explicitly here in
 * their preserved outer order. Controlled migration responses short-circuit
 * before maintenance. Maintenance then preserves its recovery allowlist,
 * public status, integration-health headers and fail-closed behavior before
 * delegating unchanged traffic to the remaining service-admin compatibility
 * graph. Later gates stay compatibility-owned until parity evidence exists.
 */
const securityComposition = {
  fetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
    return handleStorageMigrationApplyGate(request, env, ctx, {
      handleApply: handleStorageMigrationApplyRequest,
      nextFetch: (nextRequest, nextEnv, nextContext) => handleMaintenanceGate(
        nextRequest,
        nextEnv,
        nextContext,
        maintenanceDependencies(),
      ),
    });
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    return handleMaintenanceScheduledGate(controller, sourceEnv, ctx, maintenanceDependencies());
  },
};

export default securityComposition;
