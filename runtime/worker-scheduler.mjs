import { createExecutionContext } from "../scripts/node-runtime-http.mjs";
import { createNonOverlappingScheduler } from "./scheduler.mjs";

export function createWorkerScheduler(options) {
  if (!options?.worker || typeof options.worker.scheduled !== "function") {
    throw new Error("Worker artifact must export a scheduled handler");
  }

  const env = options.env ?? {};
  const cron = options.cron ?? "0 * * * *";
  const now = typeof options.now === "function" ? options.now : Date.now;

  return createNonOverlappingScheduler({
    intervalMs: options.intervalMs ?? 3_600_000,
    isReady: options.isReady,
    now,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
    async run() {
      const scheduledTime = now();
      const ctx = createExecutionContext();
      await options.worker.scheduled({
        scheduledTime,
        cron,
        noRetry() {},
      }, env, ctx);
      await ctx.drain();
    },
  });
}
