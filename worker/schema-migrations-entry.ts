import rootRuntime from "./maintenance-mode-root-entry.ts";
import { serviceAdminTokenAuthorized } from "../admin-session-authorization.ts";
import { ensurePortalSchema, type PortalSchemaStatus } from "../db/portal-migrations-hardened.ts";
import { STORAGE_INTEGRITY_PATH } from "../src/storage/integrity/storage-integrity-contract.ts";
import { STORAGE_MIGRATION_PREFLIGHT_PATH } from "../storage-migration-preflight-contract.ts";
import {
  STORAGE_MIGRATION_APPLY_PATH,
  STORAGE_MIGRATION_APPLY_STATUS_PATH,
  STORAGE_MIGRATION_RECONCILE_PATH,
} from "../storage-migration-apply-contract.ts";
import { STORAGE_STATUS_PATH } from "../src/storage/status/storage-status-contract.ts";
import { handleDependencyHealthRequest } from "./dependency-health.ts";
import { handleHealthDiagnosticsRequest } from "./health-diagnostics-ui.ts";
import { handleHealthMetricsRequest } from "./health-metrics.ts";
import { handleHealthRequest } from "./health-contracts.ts";
import {
  migrationCapableDatabase,
  schemaAuthorizationResponse,
  schemaFailureResponse,
  schemaStatusResponse,
  schemaTestBypassEnabled,
} from "./schema-migrations-boundary.ts";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  PORTAL_BUILD_VERSION?: string;
};
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

async function portalSchema(sourceEnv: RuntimeEnv): Promise<PortalSchemaStatus> {
  return await ensurePortalSchema(sourceEnv);
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    const healthResponse = await handleHealthRequest(request, sourceEnv, {
      portalSchema: async (healthEnv) => await portalSchema(healthEnv as RuntimeEnv),
      fetchImpl: fetch,
    });
    if (healthResponse) return healthResponse;

    const dependencyHealthResponse = await handleDependencyHealthRequest(request, sourceEnv, {
      portalSchema: async (dependencyEnv) => await portalSchema(dependencyEnv as RuntimeEnv),
      fetchImpl: fetch,
    });
    if (dependencyHealthResponse) return dependencyHealthResponse;

    const diagnosticsResponse = await handleHealthDiagnosticsRequest(request);
    if (diagnosticsResponse) return diagnosticsResponse;

    const metricsResponse = await handleHealthMetricsRequest(request, sourceEnv, {
      healthHandler: async (healthRequest) => await handleHealthRequest(healthRequest, sourceEnv, {
        portalSchema: async (healthEnv) => await portalSchema(healthEnv as RuntimeEnv),
        fetchImpl: fetch,
      }),
    });
    if (metricsResponse) return metricsResponse;

    if (
      url.pathname === STORAGE_STATUS_PATH
      || url.pathname === STORAGE_INTEGRITY_PATH
      || url.pathname === STORAGE_MIGRATION_PREFLIGHT_PATH
      || url.pathname === STORAGE_MIGRATION_APPLY_PATH
      || url.pathname === STORAGE_MIGRATION_APPLY_STATUS_PATH
      || url.pathname === STORAGE_MIGRATION_RECONCILE_PATH
    ) {
      return rootRuntime.fetch(request, sourceEnv, ctx);
    }

    if (url.pathname === "/api/schema/status") {
      if (!await serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)) return schemaAuthorizationResponse();
      return schemaStatusResponse(await portalSchema(sourceEnv));
    }

    if (!sourceEnv.DB) {
      if (schemaTestBypassEnabled(sourceEnv)) return rootRuntime.fetch(request, sourceEnv, ctx);
      return schemaFailureResponse(await portalSchema(sourceEnv));
    }
    if (!migrationCapableDatabase(sourceEnv.DB)) return rootRuntime.fetch(request, sourceEnv, ctx);

    const schema = await portalSchema(sourceEnv);
    if (schema.state !== "ready") return schemaFailureResponse(schema);
    return rootRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    if (!sourceEnv.DB) {
      if (schemaTestBypassEnabled(sourceEnv)) return rootRuntime.scheduled?.(controller, sourceEnv, ctx);
      return;
    }
    if (!migrationCapableDatabase(sourceEnv.DB)) return rootRuntime.scheduled?.(controller, sourceEnv, ctx);
    const schema = await portalSchema(sourceEnv);
    if (schema.state !== "ready") return;
    return rootRuntime.scheduled?.(controller, sourceEnv, ctx);
  },
};

export {
  markSchemaTestBypass,
  migrationCapableDatabase,
  schemaFailureResponse,
  schemaTestBypassEnabled,
} from "./schema-migrations-boundary.ts";
export default worker;