import {
  publicMaintenanceStatus,
  type MaintenanceState,
  type PublicMaintenanceStatus,
} from "../maintenance-mode.ts";
import { loadMaintenanceState } from "../maintenance-repository.ts";
import { schemaTestBypassEnabled } from "./schema-migrations-boundary.ts";
import { MAINTENANCE_CONTROL_PATHS } from "./maintenance-control-entry.ts";
import { MAINTENANCE_VERIFICATION_SMOKE_PATH } from "./maintenance-verification-smoke-entry.ts";

export const PUBLIC_MAINTENANCE_STATUS_PATH = "/api/maintenance/status";

const HEALTH_PATH = "/api/integrations/health";
const SCHEMA_STATUS_PATH = "/api/schema/status";
const immediatelyAllowedApiPaths = new Set([
  ...MAINTENANCE_CONTROL_PATHS,
  MAINTENANCE_VERIFICATION_SMOKE_PATH,
  SCHEMA_STATUS_PATH,
]);

export type MaintenanceGateEnv = {
  DB?: D1Database;
  [key: string]: unknown;
};

export type MaintenanceGateDependencies<
  Env extends MaintenanceGateEnv,
  Context,
  Controller,
> = {
  loadState?: typeof loadMaintenanceState;
  nextFetch: (
    request: Request,
    env: Env,
    ctx: Context,
  ) => Promise<Response>;
  nextScheduled: (
    controller: Controller,
    env: Env,
    ctx: Context,
  ) => Promise<void> | void;
};

type MaintenanceRead = {
  status: PublicMaintenanceStatus;
  unavailable: boolean;
};

function jsonResponse(value: unknown, status = 200, retry = false): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (retry) headers.set("Retry-After", "60");
  return new Response(JSON.stringify(value), { status, headers });
}

function unavailableStatus(): PublicMaintenanceStatus {
  return {
    maintenance: true,
    state: "failed",
    updatedAt: null,
    recoveryRequired: true,
  };
}

async function readMaintenance<
  Env extends MaintenanceGateEnv,
  Context,
  Controller,
>(
  env: Env,
  dependencies: MaintenanceGateDependencies<Env, Context, Controller>,
): Promise<MaintenanceRead> {
  try {
    if (!env.DB) throw new Error("database unavailable");
    const row = await (dependencies.loadState ?? loadMaintenanceState)(env.DB);
    return {
      status: publicMaintenanceStatus(row),
      unavailable: false,
    };
  } catch {
    return {
      status: unavailableStatus(),
      unavailable: true,
    };
  }
}

function activeResponse(read: MaintenanceRead): Response {
  return jsonResponse({
    error: read.unavailable ? "maintenance_state_unavailable" : "portal_maintenance_active",
    maintenance: {
      state: read.status.state,
      recoveryRequired: true,
    },
  }, 503, true);
}

function withMaintenanceHeaders(
  response: Response,
  state: MaintenanceState,
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-portal-maintenance-state", state);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleMaintenanceGate<
  Env extends MaintenanceGateEnv,
  Context,
  Controller,
>(
  request: Request,
  env: Env,
  ctx: Context,
  dependencies: MaintenanceGateDependencies<Env, Context, Controller>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;

  if (!pathname.startsWith("/api/")) return dependencies.nextFetch(request, env, ctx);
  if (immediatelyAllowedApiPaths.has(pathname)) return dependencies.nextFetch(request, env, ctx);
  if (!env.DB && schemaTestBypassEnabled(env)) return dependencies.nextFetch(request, env, ctx);

  const read = await readMaintenance(env, dependencies);
  if (pathname === PUBLIC_MAINTENANCE_STATUS_PATH) return jsonResponse(read.status);
  if (pathname === HEALTH_PATH) {
    const response = await dependencies.nextFetch(request, env, ctx);
    return withMaintenanceHeaders(response, read.status.state);
  }
  if (read.status.state !== "inactive") return activeResponse(read);
  return dependencies.nextFetch(request, env, ctx);
}

export async function handleMaintenanceScheduledGate<
  Env extends MaintenanceGateEnv,
  Context,
  Controller,
>(
  controller: Controller,
  env: Env,
  ctx: Context,
  dependencies: MaintenanceGateDependencies<Env, Context, Controller>,
): Promise<void> {
  if (!env.DB && schemaTestBypassEnabled(env)) {
    await dependencies.nextScheduled(controller, env, ctx);
    return;
  }
  const read = await readMaintenance(env, dependencies);
  if (read.status.state !== "inactive") return;
  await dependencies.nextScheduled(controller, env, ctx);
}