import {
  publicMaintenanceStatus,
  type MaintenanceState,
  type PublicMaintenanceStatus,
} from "../maintenance-mode.ts";
import { loadMaintenanceState } from "../maintenance-repository.ts";
import { schemaTestBypassEnabled } from "./schema-migrations-boundary.ts";
import rootRuntime from "./service-admin-root-entry.ts";
import { MAINTENANCE_CONTROL_PATHS } from "./maintenance-control-entry.ts";

export const PUBLIC_MAINTENANCE_STATUS_PATH = "/api/maintenance/status";

const HEALTH_PATH = "/api/integrations/health";
const SCHEMA_STATUS_PATH = "/api/schema/status";
const immediatelyAllowedApiPaths = new Set([
  ...MAINTENANCE_CONTROL_PATHS,
  SCHEMA_STATUS_PATH,
]);

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & {
  DB?: D1Database;
};
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

type GateDependencies = {
  loadState?: typeof loadMaintenanceState;
  nextFetch?: (
    request: Request,
    env: RuntimeEnv,
    ctx: RuntimeContext,
  ) => Promise<Response>;
  nextScheduled?: (
    controller: ScheduledController,
    env: RuntimeEnv,
    ctx: RuntimeContext,
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

async function readMaintenance(
  env: RuntimeEnv,
  dependencies: GateDependencies,
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

export async function handleMaintenanceGate(
  request: Request,
  env: RuntimeEnv,
  ctx: RuntimeContext,
  dependencies: GateDependencies = {},
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const nextFetch = dependencies.nextFetch ?? ((nextRequest, nextEnv, nextContext) => (
    rootRuntime.fetch(nextRequest, nextEnv, nextContext)
  ));

  if (!pathname.startsWith("/api/")) return nextFetch(request, env, ctx);
  if (immediatelyAllowedApiPaths.has(pathname)) return nextFetch(request, env, ctx);
  if (!env.DB && schemaTestBypassEnabled(env)) return nextFetch(request, env, ctx);

  const read = await readMaintenance(env, dependencies);
  if (pathname === PUBLIC_MAINTENANCE_STATUS_PATH) return jsonResponse(read.status);
  if (pathname === HEALTH_PATH) {
    const response = await nextFetch(request, env, ctx);
    return withMaintenanceHeaders(response, read.status.state);
  }
  if (read.status.state !== "inactive") return activeResponse(read);
  return nextFetch(request, env, ctx);
}

export async function handleMaintenanceScheduledGate(
  controller: ScheduledController,
  env: RuntimeEnv,
  ctx: RuntimeContext,
  dependencies: GateDependencies = {},
): Promise<void> {
  const nextScheduled = dependencies.nextScheduled ?? ((nextController, nextEnv, nextContext) => (
    rootRuntime.scheduled?.(nextController, nextEnv, nextContext)
  ));
  if (!env.DB && schemaTestBypassEnabled(env)) {
    await nextScheduled(controller, env, ctx);
    return;
  }
  const read = await readMaintenance(env, dependencies);
  if (read.status.state !== "inactive") return;
  await nextScheduled(controller, env, ctx);
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    return handleMaintenanceGate(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    return handleMaintenanceScheduledGate(controller, sourceEnv, ctx);
  },
};

export default worker;
