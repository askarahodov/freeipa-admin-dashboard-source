import { validateProductionEncryptionKey } from "./config-encryption-key.mjs";
import { validateIdentityStartup } from "./identity-startup-policy.mjs";
import { startNodeWorkerHost } from "./node-worker-host.mjs";
import { createRuntimeApplication } from "../runtime/runtime-application.mjs";
import { createRuntimeDatabase } from "../runtime/runtime-database.mjs";
import { openNodeSqliteDriver } from "../runtime/node-sqlite-driver.mjs";
import { configureSqliteRuntimeDatabase } from "../runtime/sqlite-runtime-store.mjs";
import { createD1SqliteAdapter } from "../runtime/d1-sqlite-adapter.mjs";
import { ensurePortalSchema } from "../db/portal-migrations.ts";

process.env.CONFIG_ENCRYPTION_KEY = validateProductionEncryptionKey(process.env.CONFIG_ENCRYPTION_KEY, {
  profile: process.env.PORTAL_RUNTIME_PROFILE,
});
const identityPolicy = validateIdentityStartup(process.env);
for (const warning of identityPolicy.warnings) console.warn(`[identity-policy] ${warning}`);

const env = {
  ...process.env,
  PORTAL_DATA_DIR: process.env.PORTAL_DATA_DIR || "/data",
  PORTAL_DATABASE_PATH: process.env.PORTAL_DATABASE_PATH || "/data/portal.sqlite",
};

const application = await createRuntimeApplication({
  env,
  createDatabase: ({ env: runtimeEnv }) => createRuntimeDatabase({
    env: runtimeEnv,
    openDriver: openNodeSqliteDriver,
    configureDatabase: configureSqliteRuntimeDatabase,
    createAdapter: createD1SqliteAdapter,
    ensureSchema: ensurePortalSchema,
  }),
  startHttp: ({ env: runtimeEnv }) => startNodeWorkerHost({
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 3001),
    env: runtimeEnv,
  }),
});

console.log(`Standalone Node E2E runtime listening on ${application.address?.host ?? "unknown"}:${application.address?.port ?? "unknown"}`);

let stopPromise = null;
function stop(signal) {
  if (stopPromise) return stopPromise;
  stopPromise = (async () => {
    try {
      await application.close();
      process.exitCode = 0;
    } catch (error) {
      console.error(`Standalone Node E2E runtime shutdown failed after ${signal}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  })();
  return stopPromise;
}

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));
