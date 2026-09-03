import {
  appendAuditEvent,
  type AuditContext,
  type AuditEventInput,
} from "../audit-log.ts";
import { sameOriginAdminMutation } from "../admin-session-authorization.ts";
import {
  adminMaintenanceStatus,
  maintenanceConfirmation,
  type MaintenanceRow,
  type MaintenanceState,
} from "../src/recovery/maintenance/maintenance-mode.ts";
import {
  MaintenanceRepositoryError,
  cancelMaintenance,
  completeMaintenance,
  enterMaintenance,
  exitMaintenance,
  loadMaintenanceState,
  prepareMaintenance,
  startMaintenanceVerification,
} from "../src/recovery/maintenance/maintenance-repository.ts";

export const MAINTENANCE_STATUS_PATH = "/api/admin/maintenance/status";
export const MAINTENANCE_PREPARE_PATH = "/api/admin/maintenance/prepare";
export const MAINTENANCE_ENTER_PATH = "/api/admin/maintenance/enter";
export const MAINTENANCE_VERIFICATION_START_PATH = "/api/admin/maintenance/verification/start";
export const MAINTENANCE_EXIT_PATH = "/api/admin/maintenance/exit";
export const MAINTENANCE_COMPLETE_PATH = "/api/admin/maintenance/complete";
export const MAINTENANCE_CANCEL_PATH = "/api/admin/maintenance/cancel";

export const MAINTENANCE_CONTROL_PATHS = Object.freeze([
  MAINTENANCE_STATUS_PATH,
  MAINTENANCE_PREPARE_PATH,
  MAINTENANCE_ENTER_PATH,
  MAINTENANCE_VERIFICATION_START_PATH,
  MAINTENANCE_EXIT_PATH,
  MAINTENANCE_COMPLETE_PATH,
  MAINTENANCE_CANCEL_PATH,
]);

export type MaintenanceControlEnv = { DB?: D1Database };

type MaintenanceDependencies = {
  loadState?: typeof loadMaintenanceState;
  prepare?: typeof prepareMaintenance;
  enter?: typeof enterMaintenance;
  startVerification?: typeof startMaintenanceVerification;
  exit?: typeof exitMaintenance;
  complete?: typeof completeMaintenance;
  cancel?: typeof cancelMaintenance;
  appendAudit?: typeof appendAuditEvent;
  now?: () => number;
};

type SafeError = { status: number; message: string };
type ParsedTransition = {
  operationId: string;
  controllerSecret: string;
  confirmation: string;
  verification?: unknown;
};

const encoder = new TextEncoder();
const maximumBodyBytes = 16 * 1024;
const safeErrors = new Map<string, SafeError>([
  ["maintenance_request_invalid", { status: 400, message: "Maintenance request is invalid" }],
  ["maintenance_request_too_large", { status: 413, message: "Maintenance request is too large" }],
  ["maintenance_origin_forbidden", { status: 403, message: "Maintenance mutation requires same-origin authorization" }],
  ["maintenance_method_not_allowed", { status: 405, message: "Maintenance method is not allowed" }],
  ["maintenance_state_unavailable", { status: 503, message: "Maintenance state is unavailable" }],
  ["maintenance_operation_conflict", { status: 409, message: "Maintenance operation conflicts with current state" }],
  ["maintenance_controller_invalid", { status: 409, message: "Maintenance controller is invalid" }],
  ["maintenance_confirmation_required", { status: 422, message: "Maintenance confirmation is required" }],
  ["maintenance_prepare_expired", { status: 409, message: "Maintenance prepare operation expired" }],
  ["maintenance_transition_invalid", { status: 409, message: "Maintenance transition is invalid" }],
  ["maintenance_verification_invalid", { status: 422, message: "Maintenance verification is invalid" }],
  ["maintenance_transition_failed", { status: 500, message: "Maintenance transition failed" }],
]);

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(code: string): Response {
  const safe = safeErrors.get(code) ?? safeErrors.get("maintenance_transition_failed")!;
  return jsonResponse({ error: safe.message, code }, safe.status);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedError(error: unknown): { code: string; status: number; message: string } {
  const candidate = error as { code?: unknown; status?: unknown } | null;
  const code = typeof candidate?.code === "string" && safeErrors.has(candidate.code)
    ? candidate.code
    : "maintenance_transition_failed";
  const safe = safeErrors.get(code)!;
  return { code, status: safe.status, message: safe.message };
}

function contentLengthTooLarge(request: Request): boolean {
  const value = request.headers.get("content-length");
  if (value === null) return false;
  const parsed = Number(value);
  return !Number.isFinite(parsed) || parsed < 0 || parsed > maximumBodyBytes;
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  if (contentLengthTooLarge(request)) {
    throw new MaintenanceRepositoryError(
      "maintenance_request_too_large",
      413,
      "Maintenance request is too large",
    );
  }
  const text = await request.text();
  if (encoder.encode(text).byteLength > maximumBodyBytes) {
    throw new MaintenanceRepositoryError(
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
    throw new MaintenanceRepositoryError(
      "maintenance_request_invalid",
      400,
      "Maintenance request is invalid",
    );
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseTransitionBody(value: Record<string, unknown>, withVerification: boolean): ParsedTransition {
  const keys = withVerification
    ? ["operationId", "controllerSecret", "confirmation", "verification"]
    : ["operationId", "controllerSecret", "confirmation"];
  if (!exactKeys(value, keys)
      || typeof value.operationId !== "string"
      || typeof value.controllerSecret !== "string"
      || typeof value.confirmation !== "string") {
    throw new MaintenanceRepositoryError(
      "maintenance_request_invalid",
      400,
      "Maintenance request is invalid",
    );
  }
  return {
    operationId: value.operationId,
    controllerSecret: value.controllerSecret,
    confirmation: value.confirmation,
    ...(withVerification ? { verification: value.verification } : {}),
  };
}

function safeStatus(row: MaintenanceRow): Record<string, unknown> {
  return adminMaintenanceStatus(row);
}

function transitionProjection(row: MaintenanceRow): Record<string, unknown> {
  return {
    state: row.state,
    operationId: row.operationId,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    recoveryRequired: row.state !== "inactive",
  };
}

function auditAction(pathname: string): string {
  if (pathname === MAINTENANCE_PREPARE_PATH) return "maintenance.prepare";
  if (pathname === MAINTENANCE_ENTER_PATH) return "maintenance.enter";
  if (pathname === MAINTENANCE_VERIFICATION_START_PATH) return "maintenance.verification.start";
  if (pathname === MAINTENANCE_EXIT_PATH) return "maintenance.exit";
  if (pathname === MAINTENANCE_COMPLETE_PATH) return "maintenance.complete";
  return "maintenance.cancel";
}

function expectedFromState(pathname: string): MaintenanceState {
  if (pathname === MAINTENANCE_PREPARE_PATH) return "inactive";
  if (pathname === MAINTENANCE_ENTER_PATH || pathname === MAINTENANCE_CANCEL_PATH) return "entering";
  if (pathname === MAINTENANCE_VERIFICATION_START_PATH) return "active";
  if (pathname === MAINTENANCE_EXIT_PATH) return "verifying";
  return "exiting";
}

async function appendSafeAudit(
  env: MaintenanceControlEnv,
  context: AuditContext,
  dependencies: MaintenanceDependencies,
  event: AuditEventInput,
): Promise<void> {
  try {
    await (dependencies.appendAudit ?? appendAuditEvent)(env, context, event);
  } catch {
    // Maintenance transitions are authoritative; audit persistence failure is not exposed.
  }
}

function auditMetadata(
  pathname: string,
  toState: MaintenanceState,
  updatedAt: number | null,
  verification: unknown,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    transition: auditAction(pathname),
    fromState: expectedFromState(pathname),
    toState,
    updatedAt,
  };
  if (pathname === MAINTENANCE_EXIT_PATH && plainObject(verification)) {
    metadata.verificationChecks = Object.keys(verification).sort();
  }
  return metadata;
}

export async function handleMaintenanceControlRequest(
  request: Request,
  env: MaintenanceControlEnv,
  context: AuditContext,
  dependencies: MaintenanceDependencies = {},
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!env.DB) return errorResponse("maintenance_state_unavailable");

  if (pathname === MAINTENANCE_STATUS_PATH) {
    if (request.method !== "GET") return errorResponse("maintenance_method_not_allowed");
    try {
      const row = await (dependencies.loadState ?? loadMaintenanceState)(env.DB);
      return jsonResponse(safeStatus(row as MaintenanceRow));
    } catch (error) {
      return errorResponse(normalizedError(error).code);
    }
  }

  if (!MAINTENANCE_CONTROL_PATHS.includes(pathname)) return jsonResponse({ error: "Not found" }, 404);
  if (request.method !== "POST") return errorResponse("maintenance_method_not_allowed");
  if (!sameOriginAdminMutation(request)) return errorResponse("maintenance_origin_forbidden");

  let operationId: string | undefined;
  let verification: unknown;
  try {
    const body = await parseBody(request);
    const now = dependencies.now?.() ?? Date.now();
    let row: MaintenanceRow;

    if (pathname === MAINTENANCE_PREPARE_PATH) {
      if (!exactKeys(body, [])) {
        throw new MaintenanceRepositoryError(
          "maintenance_request_invalid",
          400,
          "Maintenance request is invalid",
        );
      }
      const prepared = await (dependencies.prepare ?? prepareMaintenance)(env.DB, {
        identity: context.actor.identity,
        groups: context.actor.groups,
      }, { now: () => now });
      row = prepared.row;
      operationId = row.operationId ?? undefined;
      await appendSafeAudit(env, context, dependencies, {
        action: auditAction(pathname),
        resourceType: "portal_maintenance",
        resourceId: operationId,
        outcome: "pending",
        metadata: auditMetadata(pathname, row.state, row.updatedAt, undefined),
      });
      return jsonResponse({
        prepared: true,
        state: row.state,
        operationId: row.operationId,
        controllerSecret: prepared.secret,
        expiresAt: row.expiresAt,
        confirmation: maintenanceConfirmation("enter", row.operationId),
      });
    }

    const parsed = parseTransitionBody(body, pathname === MAINTENANCE_EXIT_PATH);
    operationId = parsed.operationId;
    verification = parsed.verification;
    const transitionInput = { ...parsed, now };
    if (pathname === MAINTENANCE_ENTER_PATH) {
      row = await (dependencies.enter ?? enterMaintenance)(env.DB, transitionInput);
    } else if (pathname === MAINTENANCE_VERIFICATION_START_PATH) {
      row = await (dependencies.startVerification ?? startMaintenanceVerification)(env.DB, transitionInput);
    } else if (pathname === MAINTENANCE_EXIT_PATH) {
      row = await (dependencies.exit ?? exitMaintenance)(env.DB, transitionInput);
    } else if (pathname === MAINTENANCE_COMPLETE_PATH) {
      row = await (dependencies.complete ?? completeMaintenance)(env.DB, transitionInput);
    } else {
      row = await (dependencies.cancel ?? cancelMaintenance)(env.DB, transitionInput);
    }

    await appendSafeAudit(env, context, dependencies, {
      action: auditAction(pathname),
      resourceType: "portal_maintenance",
      resourceId: operationId,
      outcome: "success",
      metadata: auditMetadata(pathname, row.state, row.updatedAt, verification),
    });
    return jsonResponse(transitionProjection(row));
  } catch (error) {
    const normalized = normalizedError(error);
    await appendSafeAudit(env, context, dependencies, {
      action: auditAction(pathname),
      resourceType: "portal_maintenance",
      resourceId: operationId,
      outcome: "failure",
      errorCode: normalized.code,
      metadata: {
        transition: auditAction(pathname),
        fromState: expectedFromState(pathname),
      },
    });
    return jsonResponse({ error: normalized.message, code: normalized.code }, normalized.status);
  }
}
