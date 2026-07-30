import rootRuntime from "./service-admin-root-entry.ts";
import { serviceAdminTokenAuthorized } from "../admin-session-authorization.ts";
import {
  ensurePortalSchema,
  publicPortalSchemaStatus,
  type PortalSchemaStatus,
} from "../db/portal-migrations.ts";

type RuntimeEnv = NonNullable<Parameters<typeof rootRuntime.fetch>[1]> & {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
};
type RuntimeContext = Parameters<typeof rootRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof rootRuntime.scheduled>>[0];

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

export function migrationCapableDatabase(value: unknown): value is D1Database {
  if (!value || typeof value !== "object") return false;
  const database = value as { prepare?: unknown; batch?: unknown };
  return typeof database.prepare === "function" && typeof database.batch === "function";
}

async function portalSchema(sourceEnv: RuntimeEnv): Promise<PortalSchemaStatus> {
  return await ensurePortalSchema(sourceEnv);
}

export function schemaFailureResponse(schema: PortalSchemaStatus): Response {
  const safe = publicPortalSchemaStatus(schema);
  return json({
    error: "Portal database schema is not ready",
    code: safe.errorCode || "schema_migration_failed",
    schema: safe,
  }, 503);
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);

    if (!migrationCapableDatabase(sourceEnv.DB)) return rootRuntime.fetch(request, sourceEnv, ctx);

    if (url.pathname === "/api/schema/status") {
      if (!await serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)) {
        return json({ error: "Administrator authorization required", code: "schema_authorization_required" }, 401);
      }
      const schema = await portalSchema(sourceEnv);
      return json({ schema: publicPortalSchemaStatus(schema) });
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

export default worker;
