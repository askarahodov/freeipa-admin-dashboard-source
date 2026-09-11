import compatibilityRuntime from "./maintenance-control-root-entry.ts";
import {
  handleMaintenanceGate,
  handleMaintenanceScheduledGate,
} from "./maintenance-mode-gate.ts";
import { handleServiceAdminAuthenticationGate } from "./middleware/service-admin-authentication.ts";
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
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  PORTAL_SERVICE_ADMIN_AUTHORIZED?: string;
  ADMIN_TOKEN?: string;
};
type RuntimeContext = Parameters<typeof compatibilityRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

function compatibilityDependencies() {
  return {
    nextFetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
      return compatibilityRuntime.fetch(request, env, ctx);
    },
  };
}

function maintenanceDependencies() {
  return {
    nextFetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
      return handleServiceAdminAuthenticationGate(request, env, ctx, compatibilityDependencies());
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
 * `storage-migration-apply`, maintenance and outer service-admin authentication
 * are executed explicitly here in their preserved order. Controlled migration
 * responses short-circuit before maintenance. Maintenance preserves its
 * recovery/fail-closed semantics before the service-admin gate. The
 * service-admin gate preserves the existing local-mode allowlist, constant-time
 * token check and synthetic identity environment before delegating into the
 * remaining local-security compatibility graph. Later gates stay
 * compatibility-owned until parity evidence exists.
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
