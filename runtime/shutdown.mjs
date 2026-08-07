function requireFunction(options, name) {
  if (typeof options?.[name] !== "function") throw new Error(`${name} must be a function`);
  return options[name];
}

export function createRuntimeShutdownCoordinator(options) {
  const markStopping = requireFunction(options, "markStopping");
  const closeHttp = requireFunction(options, "closeHttp");
  const stopScheduler = requireFunction(options, "stopScheduler");
  const closeGateway = requireFunction(options, "closeGateway");
  const closeDatabase = requireFunction(options, "closeDatabase");
  const timeoutMs = Number(options.timeoutMs ?? 10_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");

  let shutdownPromise = null;

  function stop(signal = "SIGTERM") {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      markStopping();
      const failures = [];
      for (const [name, action] of [
        ["http", closeHttp],
        ["scheduler", stopScheduler],
        ["gateway", closeGateway],
        ["database", closeDatabase],
      ]) {
        try {
          await action();
        } catch (error) {
          failures.push({ name, error });
        }
      }
      if (failures.length > 0) {
        const first = failures[0];
        const message = first.error instanceof Error ? first.error.message : String(first.error);
        throw new Error(`${first.name} cleanup failed: ${message}`, { cause: first.error });
      }
      return { status: "stopped", signal };
    })();

    const cleanup = shutdownPromise;
    shutdownPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`runtime shutdown timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
      cleanup.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
    return shutdownPromise;
  }

  return { stop };
}
