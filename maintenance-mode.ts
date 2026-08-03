export const MAINTENANCE_STATES = Object.freeze([
  "inactive",
  "entering",
  "active",
  "verifying",
  "exiting",
  "failed",
] as const);

export type MaintenanceState = typeof MAINTENANCE_STATES[number];
export type MaintenanceConfirmationAction = "enter" | "verify" | "exit" | "complete" | "cancel";

export type MaintenanceVerification = {
  integrity: "ok";
  schema: "ok";
  administratorAccess: "ok";
  settingsDecryption: "ok";
  auditWrite: "ok";
};

export type MaintenanceRow = {
  id: "main";
  state: MaintenanceState;
  operationId: string | null;
  actorIdentity: string | null;
  actorGroups: string[];
  controllerSecretHash: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  expiresAt: number | null;
  completedAt: number | null;
  failureCode: string | null;
  verification: Partial<MaintenanceVerification>;
};

export type PublicMaintenanceStatus = {
  maintenance: boolean;
  state: MaintenanceState;
  updatedAt: number | null;
  recoveryRequired: boolean;
};

export type AdminMaintenanceStatus = PublicMaintenanceStatus & {
  operationId: string | null;
  createdAt: number | null;
  expiresAt: number | null;
  completedAt: number | null;
  failureCode: string | null;
  verification: Partial<MaintenanceVerification>;
};

export class MaintenanceModeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "MaintenanceModeError";
    this.code = code;
    this.status = status;
  }
}

const operationIdPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controllerSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const maintenanceStateSet = new Set<string>(MAINTENANCE_STATES);
const verificationKeys = Object.freeze([
  "integrity",
  "schema",
  "administratorAccess",
  "settingsDecryption",
  "auditWrite",
] as const);
const safeFailureCodes = new Set([
  "maintenance_state_unavailable",
  "maintenance_transition_failed",
  "maintenance_verification_failed",
  "maintenance_recovery_failed",
]);

function fail(code: string, status: number, message: string): never {
  throw new MaintenanceModeError(code, status, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function safeTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeOperationId(value: unknown): string | null {
  return typeof value === "string" && operationIdPattern.test(value) ? value : null;
}

function safeFailureCode(value: unknown): string | null {
  return typeof value === "string" && safeFailureCodes.has(value) ? value : null;
}

function safeVerification(value: unknown): Partial<MaintenanceVerification> {
  if (!plainObject(value)) return {};
  const output: Partial<MaintenanceVerification> = {};
  for (const key of verificationKeys) {
    if (value[key] === "ok") output[key] = "ok";
  }
  return output;
}

function normalizedStatus(value: unknown): {
  state: MaintenanceState;
  operationId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  expiresAt: number | null;
  completedAt: number | null;
  failureCode: string | null;
  verification: Partial<MaintenanceVerification>;
} {
  if (value === null || value === undefined) {
    return {
      state: "inactive",
      operationId: null,
      createdAt: null,
      updatedAt: null,
      expiresAt: null,
      completedAt: null,
      failureCode: null,
      verification: {},
    };
  }
  if (!plainObject(value)) {
    return {
      state: "failed",
      operationId: null,
      createdAt: null,
      updatedAt: null,
      expiresAt: null,
      completedAt: null,
      failureCode: "maintenance_state_unavailable",
      verification: {},
    };
  }

  const rawState = typeof value.state === "string" ? value.state : "";
  const state: MaintenanceState = maintenanceStateSet.has(rawState)
    ? rawState as MaintenanceState
    : "failed";
  return {
    state,
    operationId: safeOperationId(value.operationId),
    createdAt: safeTimestamp(value.createdAt),
    updatedAt: safeTimestamp(value.updatedAt),
    expiresAt: safeTimestamp(value.expiresAt),
    completedAt: safeTimestamp(value.completedAt),
    failureCode: state === "failed"
      ? safeFailureCode(value.failureCode) ?? "maintenance_state_unavailable"
      : safeFailureCode(value.failureCode),
    verification: safeVerification(value.verification),
  };
}

export function createMaintenanceOperationId(): string {
  return `maintenance_${crypto.randomUUID()}`;
}

export function createMaintenanceControllerSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function hashMaintenanceControllerSecret(secret: unknown): Promise<string> {
  if (typeof secret !== "string" || !controllerSecretPattern.test(secret)) {
    fail("maintenance_controller_invalid", 400, "Maintenance controller is invalid");
  }
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
}

export async function verifyMaintenanceControllerSecret(
  expectedHash: unknown,
  secret: unknown,
): Promise<boolean> {
  if (typeof expectedHash !== "string" || !sha256Pattern.test(expectedHash)
      || typeof secret !== "string" || !controllerSecretPattern.test(secret)) return false;
  const actualHash = await hashMaintenanceControllerSecret(secret);
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= expectedHash.charCodeAt(index) ^ actualHash.charCodeAt(index);
  }
  return difference === 0;
}

export function maintenanceConfirmation(
  action: unknown,
  operationId: unknown,
): string {
  if (typeof operationId !== "string" || !operationIdPattern.test(operationId)) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  const prefixes: Record<MaintenanceConfirmationAction, string> = {
    enter: "ENTER",
    verify: "VERIFY",
    exit: "EXIT",
    complete: "RESUME",
    cancel: "CANCEL",
  };
  if (typeof action !== "string" || !Object.hasOwn(prefixes, action)) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  return `${prefixes[action as MaintenanceConfirmationAction]}:${operationId}`;
}

export function validateMaintenanceVerification(value: unknown): MaintenanceVerification {
  if (!plainObject(value)
      || Object.keys(value).length !== verificationKeys.length
      || Object.keys(value).some((key) => !verificationKeys.includes(key as typeof verificationKeys[number]))
      || verificationKeys.some((key) => value[key] !== "ok")) {
    fail("maintenance_verification_invalid", 422, "Maintenance verification is invalid");
  }
  return {
    integrity: "ok",
    schema: "ok",
    administratorAccess: "ok",
    settingsDecryption: "ok",
    auditWrite: "ok",
  };
}

export function publicMaintenanceStatus(value: unknown): PublicMaintenanceStatus {
  const normalized = normalizedStatus(value);
  return {
    maintenance: normalized.state !== "inactive",
    state: normalized.state,
    updatedAt: normalized.updatedAt,
    recoveryRequired: normalized.state !== "inactive",
  };
}

export function adminMaintenanceStatus(value: unknown): AdminMaintenanceStatus {
  const normalized = normalizedStatus(value);
  return {
    maintenance: normalized.state !== "inactive",
    state: normalized.state,
    operationId: normalized.operationId,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    expiresAt: normalized.expiresAt,
    completedAt: normalized.completedAt,
    recoveryRequired: normalized.state !== "inactive",
    failureCode: normalized.failureCode,
    verification: normalized.verification,
  };
}
