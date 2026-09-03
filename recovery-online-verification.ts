import { RecoveryError } from "./src/recovery/foundation/recovery-errors.ts";

export type RecoveryOnlineVerificationInput = {
  baseUrl: string;
  serviceToken: string;
  operationId: string;
  controllerSecret: string;
  administratorUsername: string;
  administratorPassword: string;
};

export type RecoveryOnlineVerificationResult = Readonly<{
  operationId: string;
  state: "inactive";
  checks: Readonly<{
    health: "ok";
    schema: "ok";
    administratorAccess: "ok";
    settingsDecryption: "ok";
    auditWrite: "ok";
    sessionsRevoked: "ok";
    login: "ok";
    logout: "ok";
    finalAudit: "ok";
  }>;
}>;

export type RecoveryOnlineVerificationDependencies = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const operationPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const controllerPattern = /^[A-Za-z0-9_-]{43}$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function fail(code: string, message: string, exitCode = 12): never {
  throw new RecoveryError(code, exitCode, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeInput(input: RecoveryOnlineVerificationInput): RecoveryOnlineVerificationInput & { origin: string } {
  if (!input || typeof input !== "object") {
    fail("recovery_online_request_invalid", "Online recovery verification request is invalid", 2);
  }
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    fail("recovery_online_request_invalid", "Online recovery verification request is invalid", 2);
  }
  if (!["http:", "https:"].includes(url.protocol)
      || url.username
      || url.password
      || (url.pathname !== "/" && url.pathname !== "")
      || url.search
      || url.hash
      || typeof input.serviceToken !== "string"
      || input.serviceToken.length < 1
      || input.serviceToken.length > 4096
      || input.serviceToken.includes("\0")
      || !operationPattern.test(input.operationId)
      || !controllerPattern.test(input.controllerSecret)
      || typeof input.administratorUsername !== "string"
      || input.administratorUsername.length < 3
      || input.administratorUsername.length > 64
      || typeof input.administratorPassword !== "string"
      || input.administratorPassword.length < 1
      || input.administratorPassword.length > 256) {
    fail("recovery_online_request_invalid", "Online recovery verification request is invalid", 2);
  }
  return { ...input, baseUrl: url.origin, origin: url.origin };
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  if (length !== null) {
    const declared = Number(length);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES) {
      fail("recovery_online_response_invalid", "Online recovery response is invalid");
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    fail("recovery_online_response_invalid", "Online recovery response is invalid");
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!plainObject(parsed)) throw new Error("invalid body");
    return parsed;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_online_response_invalid", "Online recovery response is invalid");
  } finally {
    bytes.fill(0);
  }
}

function requestHeaders(input: RecoveryOnlineVerificationInput & { origin: string }, mutation: boolean): Headers {
  const headers = new Headers({
    accept: "application/json",
    "cache-control": "no-store",
    "x-admin-token": input.serviceToken,
  });
  if (mutation) {
    headers.set("content-type", "application/json");
    headers.set("origin", input.origin);
  }
  return headers;
}

async function requestJson(
  input: RecoveryOnlineVerificationInput & { origin: string },
  dependencies: Required<RecoveryOnlineVerificationDependencies>,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    serviceAdmin?: boolean;
    cookie?: string;
  } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const method = options.method ?? "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs);
  try {
    const headers = options.serviceAdmin === false
      ? new Headers({ accept: "application/json", "cache-control": "no-store" })
      : requestHeaders(input, method === "POST");
    if (method === "POST" && options.serviceAdmin === false) {
      headers.set("content-type", "application/json");
      headers.set("origin", input.origin);
    }
    if (options.cookie) headers.set("cookie", options.cookie);
    const url = new URL(path, input.baseUrl);
    const response = await dependencies.fetch(url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const body = await boundedJson(response);
    if (!response.ok) fail("recovery_online_request_failed", "Online recovery request failed");
    return { response, body };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_online_request_failed", "Online recovery request failed");
  } finally {
    clearTimeout(timer);
  }
}

function requireMaintenanceStatus(body: Record<string, unknown>, operationId: string): "active" | "verifying" | "exiting" | "inactive" {
  const state = body.state;
  if (!["active", "verifying", "exiting", "inactive"].includes(String(state))) {
    fail("recovery_online_response_invalid", "Online recovery response is invalid");
  }
  if (state !== "inactive" && body.operationId !== operationId) {
    fail("recovery_online_operation_mismatch", "Online recovery operation does not match");
  }
  return state as "active" | "verifying" | "exiting" | "inactive";
}

function requireSmoke(body: Record<string, unknown>, operationId: string) {
  if (body.operationId !== operationId || !plainObject(body.checks)) {
    fail("recovery_online_response_invalid", "Online recovery response is invalid");
  }
  const checks = body.checks;
  for (const key of ["administratorAccess", "settingsDecryption", "auditWrite", "sessionsRevoked"]) {
    if (checks[key] !== "ok") fail("recovery_online_smoke_failed", "Online recovery smoke failed");
  }
  return checks as {
    administratorAccess: "ok";
    settingsDecryption: "ok";
    auditWrite: "ok";
    sessionsRevoked: "ok";
  };
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie") ?? "";
  const match = /(?:^|,\s*)portal_session=([^;\s,]+)/u.exec(value);
  if (!match) fail("recovery_online_login_failed", "Online recovery login verification failed");
  return `portal_session=${match[1]}`;
}

export async function verifyPortalRecoveryOnline(
  inputValue: RecoveryOnlineVerificationInput,
  dependencyValue: RecoveryOnlineVerificationDependencies = {},
): Promise<RecoveryOnlineVerificationResult> {
  const input = normalizeInput(inputValue);
  const timeoutMs = dependencyValue.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    fail("recovery_online_request_invalid", "Online recovery verification request is invalid", 2);
  }
  const dependencies: Required<RecoveryOnlineVerificationDependencies> = {
    fetch: dependencyValue.fetch ?? fetch,
    timeoutMs,
  };

  const health = await requestJson(input, dependencies, "/api/integrations/health");
  if (health.body.ok === false) fail("recovery_online_health_failed", "Online recovery health verification failed");

  const schema = await requestJson(input, dependencies, "/api/schema/status");
  if (schema.body.state !== "ready" || !Number.isSafeInteger(Number(schema.body.currentVersion))) {
    fail("recovery_online_schema_failed", "Online recovery schema verification failed");
  }

  const initial = await requestJson(input, dependencies, "/api/admin/maintenance/status");
  let state = requireMaintenanceStatus(initial.body, input.operationId);
  if (state !== "active" && state !== "verifying") {
    fail("recovery_online_state_invalid", "Online recovery maintenance state is invalid");
  }

  const smokeResponse = await requestJson(input, dependencies, "/api/admin/maintenance/verification/smoke", {
    method: "POST",
    body: {
      operationId: input.operationId,
      controllerSecret: input.controllerSecret,
      administratorUsername: input.administratorUsername,
      administratorPassword: input.administratorPassword,
    },
  });
  const smoke = requireSmoke(smokeResponse.body, input.operationId);

  if (state === "active") {
    const started = await requestJson(input, dependencies, "/api/admin/maintenance/verification/start", {
      method: "POST",
      body: {
        operationId: input.operationId,
        controllerSecret: input.controllerSecret,
        confirmation: `VERIFY:${input.operationId}`,
      },
    });
    state = requireMaintenanceStatus(started.body, input.operationId);
    if (state !== "verifying") fail("recovery_online_state_invalid", "Online recovery maintenance state is invalid");
  }

  const exited = await requestJson(input, dependencies, "/api/admin/maintenance/exit", {
    method: "POST",
    body: {
      operationId: input.operationId,
      controllerSecret: input.controllerSecret,
      confirmation: `EXIT:${input.operationId}`,
      verification: {
        integrity: "ok",
        schema: "ok",
        administratorAccess: smoke.administratorAccess,
        settingsDecryption: smoke.settingsDecryption,
        auditWrite: smoke.auditWrite,
      },
    },
  });
  state = requireMaintenanceStatus(exited.body, input.operationId);
  if (state !== "exiting") fail("recovery_online_state_invalid", "Online recovery maintenance state is invalid");

  const completed = await requestJson(input, dependencies, "/api/admin/maintenance/complete", {
    method: "POST",
    body: {
      operationId: input.operationId,
      controllerSecret: input.controllerSecret,
      confirmation: `RESUME:${input.operationId}`,
    },
  });
  if (requireMaintenanceStatus(completed.body, input.operationId) !== "inactive") {
    fail("recovery_online_state_invalid", "Online recovery maintenance state is invalid");
  }

  const finalStatus = await requestJson(input, dependencies, "/api/admin/maintenance/status");
  if (requireMaintenanceStatus(finalStatus.body, input.operationId) !== "inactive") {
    fail("recovery_online_state_invalid", "Online recovery maintenance state is invalid");
  }

  const login = await requestJson(input, dependencies, "/api/auth/login", {
    method: "POST",
    serviceAdmin: false,
    body: { username: input.administratorUsername, password: input.administratorPassword },
  });
  const cookie = sessionCookie(login.response);
  let finalAudit: "ok" | null = null;
  let logout: "ok" | null = null;
  try {
    const audit = await requestJson(
      input,
      dependencies,
      `/api/integrations/audit?action=${encodeURIComponent("portal.full_restore.verification_smoke")}&limit=20`,
      { serviceAdmin: false, cookie },
    );
    const events = Array.isArray(audit.body.events) ? audit.body.events : [];
    if (!events.some((event) => plainObject(event)
        && event.action === "portal.full_restore.verification_smoke"
        && event.resourceId === input.operationId)) {
      fail("recovery_online_audit_failed", "Online recovery final audit verification failed");
    }
    finalAudit = "ok";
  } finally {
    const result = await requestJson(input, dependencies, "/api/auth/logout", {
      method: "POST",
      serviceAdmin: false,
      cookie,
      body: {},
    });
    if (result.response.ok) logout = "ok";
  }
  if (finalAudit !== "ok" || logout !== "ok") {
    fail("recovery_online_post_complete_failed", "Online recovery post-completion verification failed");
  }

  return Object.freeze({
    operationId: input.operationId,
    state: "inactive",
    checks: Object.freeze({
      health: "ok",
      schema: "ok",
      administratorAccess: smoke.administratorAccess,
      settingsDecryption: smoke.settingsDecryption,
      auditWrite: smoke.auditWrite,
      sessionsRevoked: smoke.sessionsRevoked,
      login: "ok",
      logout,
      finalAudit,
    }),
  });
}
