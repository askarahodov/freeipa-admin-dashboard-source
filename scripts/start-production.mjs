import { randomBytes } from "node:crypto";

import { createFreeIpaGateway } from "./freeipa-gateway.mjs";
import { loadWorkerArtifact, startNodeWorkerHost } from "./node-worker-host.mjs";
import { createRuntimeApplication } from "../runtime/runtime-application.mjs";
import { createRuntimeDatabase } from "../runtime/runtime-database.mjs";
import { createRuntimeShutdownCoordinator } from "../runtime/shutdown.mjs";
import { createWorkerScheduler } from "../runtime/worker-scheduler.mjs";
import { createD1SqliteAdapter } from "../runtime/d1-sqlite-adapter.mjs";
import { openNodeSqliteDriver } from "../runtime/node-sqlite-driver.mjs";
import { configureSqliteRuntimeDatabase } from "../runtime/sqlite-runtime-store.mjs";
import { ensurePortalSchema } from "../db/portal-migrations.ts";
import { startProductionRuntime } from "../runtime/production-runtime.mjs";

async function startGateway({ env }) {
  const token = randomBytes(32).toString("hex");
  const server = createFreeIpaGateway({ token });
  const requestedPort = Number(env.IPA_GATEWAY_PORT ?? 0);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error("IPA_GATEWAY_PORT must be an integer between 0 and 65535");
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("FreeIPA Gateway did not acquire a TCP port");
  }

  return {
    env: {
      ...env,
      IPA_NODE_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
      IPA_NODE_GATEWAY_TOKEN: token,
    },
    address: { host: address.address, port: address.port },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function createDatabase({ env }) {
  return createRuntimeDatabase({
    env,
    openDriver: openNodeSqliteDriver,
    configureDatabase: configureSqliteRuntimeDatabase,
    createAdapter: createD1SqliteAdapter,
    ensureSchema: ensurePortalSchema,
  });
}

function createApplication({ env, worker }) {
  return createRuntimeApplication({
    env,
    createDatabase,
    startHttp: ({ env: runtimeEnv }) => startNodeWorkerHost({
      artifactPath: process.env.PORTAL_WORKER_ARTIFACT || "dist/server/index.js",
      assetsRoot: process.env.PORTAL_ASSETS_ROOT || "dist/client",
      worker,
      host: runtimeEnv.HOST || "0.0.0.0",
      port: Number(runtimeEnv.PORT || 3001),
      env: runtimeEnv,
    }),
  });
}

function createScheduler({ worker, env, isReady }) {
  return createWorkerScheduler({
    worker,
    env,
    isReady,
    cron: env.PORTAL_SCHEDULE_CRON || "0 * * * *",
    intervalMs: Number(env.PORTAL_SCHEDULE_INTERVAL_MS || 3_600_000),
  });
}

export function createProductionRuntimeOptions({ env = process.env } = {}) {
  const options = {
    env,
    loadWorker: () => loadWorkerArtifact(env.PORTAL_WORKER_ARTIFACT || "dist/server/index.js"),
    startGateway,
    createApplication,
    createScheduler,
    createShutdownCoordinator: (shutdownOptions) => createRuntimeShutdownCoordinator({
      ...shutdownOptions,
      timeoutMs: Number(env.PORTAL_SHUTDOWN_TIMEOUT_MS || 10_000),
    }),
  };

  options.start = (overrides = options) => startProductionRuntime(overrides);
  return options;
}

async function main() {
  const runtime = await createProductionRuntimeOptions().start(createProductionRuntimeOptions());
  const address = runtime.address;
  console.log(`Production runtime listening on ${address?.host ?? "unknown"}:${address?.port ?? "unknown"}`);

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    try {
      await runtime.stop(signal);
      process.exitCode = 0;
    } catch (error) {
      console.error(`Production runtime shutdown failed after ${signal}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main();
}
