import { resolvePortalDatabasePath } from "./sqlite-runtime-store.mjs";

function requireFunction(options, name) {
  if (typeof options?.[name] !== "function") throw new Error(`${name} must be a function`);
  return options[name];
}

export async function createRuntimeDatabase(options = {}) {
  const openDriver = requireFunction(options, "openDriver");
  const configureDatabase = requireFunction(options, "configureDatabase");
  const createAdapter = requireFunction(options, "createAdapter");
  const ensureSchema = requireFunction(options, "ensureSchema");
  const env = options.env ?? {};
  const path = resolvePortalDatabasePath(env);

  let driver = null;
  let closed = false;

  function closeDriver() {
    if (!driver || closed) return;
    closed = true;
    driver.close();
  }

  try {
    driver = openDriver(path);
    if (!driver || typeof driver.close !== "function") {
      throw new Error("SQLite runtime driver must provide close()");
    }

    configureDatabase(driver);
    const DB = createAdapter(driver);
    const schema = await ensureSchema({ ...env, DB });
    if (!schema || schema.state !== "ready") {
      const state = String(schema?.state ?? "unknown");
      throw new Error(`runtime database schema is not ready: ${state}`);
    }

    return {
      path,
      DB,
      schema,
      close: closeDriver,
    };
  } catch (error) {
    try {
      closeDriver();
    } catch {
      // Preserve the original startup failure.
    }
    throw error;
  }
}
