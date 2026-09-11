import rootRuntime from "./application.ts";
import { serviceAdminTokenAuthorized } from "../src/auth/admin-session-authorization.ts";
import { ensurePortalSchema, type PortalSchemaStatus } from "../db/portal-migrations-hardened.ts";
import { STORAGE_INTEGRITY_PATH } from "../src/storage/integrity/storage-integrity-contract.ts";
import { STORAGE_MIGRATION_PREFLIGHT_PATH } from "../src/storage/migration/preflight/storage-migration-preflight-contract.ts";
import {
  STORAGE_MIGRATION_APPLY_PATH,
  STORAGE_MIGRATION_APPLY_STATUS_PATH,
  STORAGE_MIGRATION_RECONCILE_PATH,
} from "../src/storage/migration/apply/storage-migration-apply-contract.ts";
import { STORAGE_STATUS_PATH } from "../src/storage/status/storage-status-contract.ts";
import { isPreSchemaHealthApplicationRequest } from "./health-http.ts";
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

    // Health/diagnostics infrastructure intentionally remains reachable before
    // ordinary schema readiness. The schema boundary owns only this pass-through;
    // actual route dispatch is registered in the explicit application composition.
    if (isPreSchemaHealthApplicationRequest(request)) {
      return rootRuntime.fetch(request, sourceEnv, ctx);
    }

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
