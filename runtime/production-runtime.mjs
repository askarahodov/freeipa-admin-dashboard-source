function requireFunction(options, name) {
  if (typeof options?.[name] !== "function") throw new Error(`${name} must be a function`);
  return options[name];
}

async function safeClose(action) {
  if (typeof action !== "function") return;
  try {
    await action();
  } catch {
    // Startup cleanup must preserve the original failure.
  }
}

export async function startProductionRuntime(options = {}) {
  const loadWorker = requireFunction(options, "loadWorker");
  const startGateway = requireFunction(options, "startGateway");
  const createApplication = requireFunction(options, "createApplication");
  const createScheduler = requireFunction(options, "createScheduler");
  const createShutdownCoordinator = requireFunction(options, "createShutdownCoordinator");
  const env = options.env ?? {};

  let gateway = null;
  let application = null;
  let scheduler = null;
  let ready = false;

  try {
    const worker = await loadWorker();

    gateway = await startGateway({ env });
    if (!gateway || typeof gateway.close !== "function") {
      throw new Error("runtime gateway must provide close()");
    }
    const runtimeEnv = gateway.env ?? env;

    application = await createApplication({ env: runtimeEnv, worker });
    if (!application?.http || typeof application.http.close !== "function") {
      throw new Error("runtime application must provide http.close()");
    }
    if (!application?.database || typeof application.database.close !== "function") {
      throw new Error("runtime application must provide database.close()");
    }

    ready = true;
    scheduler = createScheduler({
      worker,
      env: { ...runtimeEnv, DB: application.database.DB },
      isReady: () => ready,
    });
    if (!scheduler || typeof scheduler.start !== "function" || typeof scheduler.stop !== "function") {
      throw new Error("runtime scheduler must provide start() and stop()");
    }

    const shutdown = createShutdownCoordinator({
      markStopping() { ready = false; },
      closeHttp: () => application.http.close(),
      stopScheduler: () => scheduler.stop(),
      closeGateway: () => gateway.close(),
      closeDatabase: () => application.database.close(),
    });
    if (!shutdown || typeof shutdown.stop !== "function") {
      throw new Error("runtime shutdown coordinator must provide stop()");
    }

    scheduler.start();

    return {
      worker,
      gateway,
      application,
      scheduler,
      address: application.address ?? null,
      ready: () => ready,
      stop: (signal) => shutdown.stop(signal),
    };
  } catch (error) {
    ready = false;
    await safeClose(scheduler && typeof scheduler.stop === "function" ? () => scheduler.stop() : null);
    await safeClose(application?.http && typeof application.http.close === "function" ? () => application.http.close() : null);
    await safeClose(application?.database && typeof application.database.close === "function" ? () => application.database.close() : null);
    await safeClose(gateway && typeof gateway.close === "function" ? () => gateway.close() : null);
    throw error;
  }
}
