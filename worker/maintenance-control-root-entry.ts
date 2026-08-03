import rootRuntime from "./backup-selective-restore-root-entry";
import {
  handleMaintenanceControlRoute,
  type MaintenanceControlRuntimeEnv,
} from "./maintenance-control-dispatch.ts";

export { handleMaintenanceControlRoute } from "./maintenance-control-dispatch.ts";
export type { MaintenanceControlDispatchDependencies } from "./maintenance-control-dispatch.ts";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & MaintenanceControlRuntimeEnv;
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const maintenanceResponse = await handleMaintenanceControlRoute(request, sourceEnv);
    if (maintenanceResponse) return maintenanceResponse;
    return rootRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return rootRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
