export function createNonOverlappingScheduler(options) {
  const intervalMs = Number(options?.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("intervalMs must be a positive number");
  if (typeof options?.run !== "function") throw new Error("run must be a function");

  const isReady = typeof options.isReady === "function" ? options.isReady : async () => true;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const setTimer = typeof options.setTimer === "function" ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === "function" ? options.clearTimer : clearTimeout;

  let started = false;
  let timer = null;
  let active = null;
  let lastStartedAt = null;
  let lastFinishedAt = null;
  let lastOutcome = null;
  let nextRunAt = null;

  async function runNow() {
    if (active) return { status: "skipped", reason: "overlap" };
    if (!await isReady()) return { status: "skipped", reason: "unready" };

    lastStartedAt = now();
    const execution = (async () => {
      try {
        await options.run();
        lastOutcome = "success";
        return { status: "success" };
      } catch {
        lastOutcome = "failed";
        return { status: "failed" };
      } finally {
        lastFinishedAt = now();
        active = null;
      }
    })();
    active = execution;
    return execution;
  }

  function scheduleNext() {
    if (!started) return;
    nextRunAt = now() + intervalMs;
    timer = setTimer(async () => {
      timer = null;
      nextRunAt = null;
      await runNow();
      scheduleNext();
    }, intervalMs);
  }

  function start() {
    if (started) return;
    started = true;
    scheduleNext();
  }

  async function stop() {
    if (!started && !active) return;
    started = false;
    nextRunAt = null;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (active) await active;
  }

  function status() {
    return {
      started,
      running: Boolean(active),
      lastStartedAt,
      lastFinishedAt,
      lastOutcome,
      nextRunAt,
    };
  }

  return { start, stop, runNow, status };
}
