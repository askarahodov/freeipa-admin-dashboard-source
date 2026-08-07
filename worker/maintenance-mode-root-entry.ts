import rootRuntime from "./service-admin-root-entry.ts";
import {
  handleMaintenanceGate,
  handleMaintenanceScheduledGate,
} from "./maintenance-mode-gate.ts";
import { handleStorageMigrationApplyRequest } from "./storage-migration-apply-entry.ts";

export {
  handleMaintenanceGate,
  handleMaintenanceScheduledGate,
  PUBLIC_MAINTENANCE_STATUS_PATH,
} from "./maintenance-mode-gate.ts";
export type {
  MaintenanceGateDependencies,
  MaintenanceGateEnv,
} from "./maintenance-mode-gate.ts";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & {
  DB?: D1Database;
};
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

function dependencies() {
  return {
    nextFetch(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<Response> {
      return rootRuntime.fetch(request, env, ctx);
    },
    nextScheduled(
      controller: ScheduledController,
      env: RuntimeEnv,
      ctx: RuntimeContext,
    ): Promise<void> | void {
      return rootRuntime.scheduled?.(controller, env, ctx);
    },
  };
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const migrationResponse = await handleStorageMigrationApplyRequest(request, sourceEnv);
    if (migrationResponse) return migrationResponse;
    return handleMaintenanceGate(request, sourceEnv, ctx, dependencies());
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    return handleMaintenanceScheduledGate(controller, sourceEnv, ctx, dependencies());
  },
};

export default worker;
