import { publicPortalSchemaStatus, type PortalSchemaStatus } from "../db/portal-migrations.ts";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

export function migrationCapableDatabase(value: unknown): value is D1Database {
  if (!value || typeof value !== "object") return false;
  const database = value as { prepare?: unknown; batch?: unknown };
  return typeof database.prepare === "function" && typeof database.batch === "function";
}

export function schemaFailureResponse(schema: PortalSchemaStatus): Response {
  const safe = publicPortalSchemaStatus(schema);
  return json({
    error: "Portal database schema is not ready",
    code: safe.errorCode || "schema_migration_failed",
    schema: safe,
  }, 503);
}

export function schemaStatusResponse(schema: PortalSchemaStatus): Response {
  return json({ schema: publicPortalSchemaStatus(schema) });
}

export function schemaAuthorizationResponse(): Response {
  return json({ error: "Administrator authorization required", code: "schema_authorization_required" }, 401);
}
