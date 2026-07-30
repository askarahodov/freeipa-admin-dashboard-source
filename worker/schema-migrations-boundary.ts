import { publicPortalSchemaStatus, type PortalSchemaStatus } from "../db/portal-migrations.ts";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const schemaTestBypassMarker = Symbol.for("freeipa-admin-dashboard.schema-test-bypass.v1");

type SchemaTestEnv = Record<PropertyKey, unknown>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

export function migrationCapableDatabase(value: unknown): value is D1Database {
  if (!value || typeof value !== "object") return false;
  const database = value as { prepare?: unknown; batch?: unknown };
  return typeof database.prepare === "function" && typeof database.batch === "function";
}

export function markSchemaTestBypass<T extends object>(environment: T): T {
  Object.defineProperty(environment, schemaTestBypassMarker, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return environment;
}

export function schemaTestBypassEnabled(environment: unknown): boolean {
  return Boolean(environment && typeof environment === "object" && (environment as SchemaTestEnv)[schemaTestBypassMarker] === true);
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
