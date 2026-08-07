function requireFunction(options, name) {
  if (typeof options?.[name] !== "function") throw new Error(`${name} must be a function`);
  return options[name];
}

export async function createRuntimeApplication(options = {}) {
  const createDatabase = requireFunction(options, "createDatabase");
  const startHttp = requireFunction(options, "startHttp");
  const env = options.env ?? {};

  const database = await createDatabase({ env });
  if (!database || typeof database.close !== "function") {
    throw new Error("runtime database must provide close()");
  }

  let http;
  try {
    http = await startHttp({
      env: { ...env, DB: database.DB },
      database,
    });
    if (!http || typeof http.close !== "function") {
      throw new Error("runtime HTTP host must provide close()");
    }
  } catch (error) {
    try {
      await database.close();
    } catch {
      // Preserve the original HTTP startup failure.
    }
    throw error;
  }

  let closePromise = null;
  function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      let httpFailure = null;
      try {
        await http.close();
      } catch (error) {
        httpFailure = error;
      }

      try {
        await database.close();
      } catch (error) {
        if (!httpFailure) throw error;
      }

      if (httpFailure) throw httpFailure;
    })();
    return closePromise;
  }

  return {
    database,
    http,
    address: http.address ?? null,
    close,
  };
}
