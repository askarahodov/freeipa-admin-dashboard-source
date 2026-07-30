import rootRuntime from "./service-admin-root-entry.ts";
import { serviceAdminTokenAuthorized } from "../admin-session-authorization.ts";
import { ensurePortalSchema, type PortalSchemaStatus } from "../db/portal-migrations.ts";
import {
  migrationCapableDatabase,
  schemaAuthorizationResponse,
  schemaFailureResponse,
  schemaStatusResponse,
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

    if (!migrationCapableDatabase(sourceEnv.DB)) return rootRuntime.fetch(request, sourceEnv, ctx);

    if (url.pathname === "/api/schema/status") {
      if (!await serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)) return schemaAuthorizationResponse();
      return schemaStatusResponse(await portalSchema(sourceEnv));
    }

    const schema = await portalSchema(sourceEnv);
    if (schema.state !== "ready") return schemaFailureResponse(schema);
    return rootRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    if (!migrationCapableDatabase(sourceEnv.DB)) return rootRuntime.scheduled?.(controller, sourceEnv, ctx);
    const schema = await portalSchema(sourceEnv);
    if (schema.state !== "ready") return;
    return rootRuntime.scheduled?.(controller, sourceEnv, ctx);
  },
};

export { migrationCapableDatabase, schemaFailureResponse } from "./schema-migrations-boundary.ts";
export default worker;
