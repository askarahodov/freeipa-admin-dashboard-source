import compatibilityRuntime from "./maintenance-control-root-entry.ts";
import { handleMaintenanceScheduledGate } from "./maintenance-mode-gate.ts";

export type ApplicationScheduledEnv = NonNullable<Parameters<typeof compatibilityRuntime.fetch>[1]> & {
  DB?: D1Database;
};
export type ApplicationScheduledContext = Parameters<typeof compatibilityRuntime.fetch>[2];
export type ApplicationScheduledController = Parameters<NonNullable<typeof compatibilityRuntime.scheduled>>[0];

export async function handleApplicationScheduled(
  controller: ApplicationScheduledController,
  env: ApplicationScheduledEnv | undefined,
  ctx: ApplicationScheduledContext,
): Promise<void> {
  const sourceEnv = env ?? (process.env as unknown as ApplicationScheduledEnv);
  return handleMaintenanceScheduledGate(controller, sourceEnv, ctx, {
    nextScheduled(nextController, nextEnv, nextContext): Promise<void> | void {
      return compatibilityRuntime.scheduled?.(nextController, nextEnv, nextContext);
    },
  });
}
