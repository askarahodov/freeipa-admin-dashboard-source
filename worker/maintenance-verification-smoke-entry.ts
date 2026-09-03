import type { AuditContext } from "../audit-log.ts";
import { sameOriginAdminMutation } from "../admin-session-authorization.ts";
import {
  MaintenanceVerificationSmokeError,
  runMaintenanceVerificationSmoke,
} from "../src/recovery/maintenance/maintenance-verification-smoke.ts";

export const MAINTENANCE_VERIFICATION_SMOKE_PATH = "/api/admin/maintenance/verification/smoke";

export type MaintenanceVerificationSmokeEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
};

export type MaintenanceVerificationSmokeDependencies = {
  smoke?: typeof runMaintenanceVerificationSmoke;
  now?: () => number;
};

const maximumBodyBytes = 16 * 1024;
const encoder = new TextEncoder();
const safeErrors = new Map<string, { status: number; message: string }>([
  ["maintenance_request_invalid", { status: 400, message: "Maintenance request is invalid" }],
  ["maintenance_request_too_large", { status: 413, message: "Maintenance request is too large" }],
  ["maintenance_origin_forbidden", { status: 403, message: "Maintenance mutation requires same-origin authorization" }],
  ["maintenance_method_not_allowed", { status: 405, message: "Maintenance method is not allowed" }],
  ["maintenance_state_unavailable", { status: 503, message: "Maintenance state is unavailable" }],
  ["maintenance_transition_invalid", { status: 409, message: "Maintenance transition is invalid" }],
  ["maintenance_controller_invalid", { status: 409, message: "Maintenance controller is invalid" }],
  ["maintenance_smoke_credentials_invalid", { status: 422, message: "Maintenance verification credentials are invalid" }],
  ["maintenance_smoke_settings_invalid", { status: 422, message: "Maintenance settings verification failed" }],
  ["maintenance_smoke_audit_invalid", { status: 500, message: "Maintenance audit verification failed" }],
  ["maintenance_smoke_failed", { status: 500, message: "Maintenance verification failed" }],
]);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(code: string): Response {
  const safe = safeErrors.get(code) ?? safeErrors.get("maintenance_smoke_failed")!;
  return json({ error: safe.message, code }, safe.status);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > maximumBodyBytes) {
      throw new MaintenanceVerificationSmokeError(
        "maintenance_request_too_large",
        413,
        "Maintenance request is too large",
      );
    }
  }
  const text = await request.text();
  if (encoder.encode(text).byteLength > maximumBodyBytes) {
    throw new MaintenanceVerificationSmokeError(
      "maintenance_request_too_large",
      413,
      "Maintenance request is too large",
    );
  }
  try {
    const parsed = JSON.parse(text || "{}");
    if (!plainObject(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new MaintenanceVerificationSmokeError(
      "maintenance_request_invalid",
      400,
      "Maintenance request is invalid",
    );
  }
}

function validateBody(value: Record<string, unknown>): {
  operationId: string;
  controllerSecret: string;
  administratorUsername: string;
  administratorPassword: string;
} {
  if (!exactKeys(value, [
    "operationId",
    "controllerSecret",
    "administratorUsername",
    "administratorPassword",
  ])
      || typeof value.operationId !== "string"
      || typeof value.controllerSecret !== "string"
      || typeof value.administratorUsername !== "string"
      || value.administratorUsername.length < 3
      || value.administratorUsername.length > 64
      || typeof value.administratorPassword !== "string"
      || value.administratorPassword.length < 1
      || value.administratorPassword.length > 256) {
    throw new MaintenanceVerificationSmokeError(
      "maintenance_request_invalid",
      400,
      "Maintenance request is invalid",
    );
  }
  return {
    operationId: value.operationId,
    controllerSecret: value.controllerSecret,
    administratorUsername: value.administratorUsername,
    administratorPassword: value.administratorPassword,
  };
}

function normalizedError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && safeErrors.has(code) ? code : "maintenance_smoke_failed";
}

export async function handleMaintenanceVerificationSmokeRequest(
  request: Request,
  env: MaintenanceVerificationSmokeEnv,
  context: AuditContext,
  dependencies: MaintenanceVerificationSmokeDependencies = {},
): Promise<Response> {
  if (new URL(request.url).pathname !== MAINTENANCE_VERIFICATION_SMOKE_PATH) {
    return json({ error: "Not found" }, 404);
  }
  if (request.method !== "POST") return errorResponse("maintenance_method_not_allowed");
  if (!sameOriginAdminMutation(request)) return errorResponse("maintenance_origin_forbidden");
  if (!env.DB) return errorResponse("maintenance_state_unavailable");
  try {
    const body = validateBody(await parseBody(request));
    const result = await (dependencies.smoke ?? runMaintenanceVerificationSmoke)({
      db: env.DB,
      configEncryptionKey: env.CONFIG_ENCRYPTION_KEY,
      operationId: body.operationId,
      controllerSecret: body.controllerSecret,
      administratorUsername: body.administratorUsername,
      administratorPassword: body.administratorPassword,
      auditContext: context,
      now: dependencies.now?.() ?? Date.now(),
    });
    return json(result);
  } catch (error) {
    return errorResponse(normalizedError(error));
  }
}
