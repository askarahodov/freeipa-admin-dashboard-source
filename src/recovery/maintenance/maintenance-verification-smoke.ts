import type { AuditContext } from "../../../audit-log.ts";
import { loadMaintenanceState } from "./maintenance-repository.ts";
import { verifyMaintenanceControllerSecret, type MaintenanceRow } from "./maintenance-mode.ts";

export class MaintenanceVerificationSmokeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "MaintenanceVerificationSmokeError";
    this.code = code;
    this.status = status;
  }
}

export type MaintenanceVerificationSmokeInput = {
  db: D1Database;
  configEncryptionKey?: string;
  operationId: unknown;
  controllerSecret: unknown;
  administratorUsername: unknown;
  administratorPassword: unknown;
  auditContext: AuditContext;
  now?: unknown;
};

export type MaintenanceVerificationSmokeResult = {
  operationId: string;
  checks: {
    administratorAccess: "ok";
    settingsDecryption: "ok";
    auditWrite: "ok";
    sessionsRevoked: "ok";
  };
};

type SmokeDependencies = {
  loadState?: typeof loadMaintenanceState;
  verifyController?: (expectedHash: string, secret: string) => Promise<boolean>;
  verifyAdministrator?: typeof verifyAdministratorReadOnly;
  verifySettings?: typeof verifyActiveSettingsDecryption;
  auditSmoke?: typeof runAuditAndSessionSmoke;
};

type UserCredentialRow = {
  id: unknown;
  password_hash: unknown;
  password_salt: unknown;
  password_iterations: unknown;
  role: unknown;
  disabled: unknown;
  locked_until: unknown;
};

const operationPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const controllerPattern = /^[A-Za-z0-9_-]{43}$/u;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;
const MAX_SETTINGS_ENVELOPE_BYTES = 20 * 1024 * 1024;

function fail(code: string, status: number, message: string): never {
  throw new MaintenanceVerificationSmokeError(code, status, message);
}

function normalizeNow(value: unknown): number {
  const now = Number(value ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 1) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  return now;
}

function normalizedUsername(value: unknown): string {
  const username = String(value ?? "").trim().toLowerCase();
  if (!usernamePattern.test(username)) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  return username;
}

function normalizedPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || value.includes("\0")) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  return value;
}

function strictBase64(value: unknown): Uint8Array {
  if (typeof value !== "string"
      || value.length < 4
      || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail("maintenance_smoke_credentials_invalid", 422, "Maintenance verification credentials are invalid");
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    let canonical = "";
    for (const byte of bytes) canonical += String.fromCharCode(byte);
    if (btoa(canonical) !== value) throw new Error("non-canonical");
    return bytes;
  } catch {
    fail("maintenance_smoke_credentials_invalid", 422, "Maintenance verification credentials are invalid");
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function verifyAdministratorReadOnly(
  db: D1Database,
  usernameValue: unknown,
  passwordValue: unknown,
  nowValue: unknown = Date.now(),
): Promise<{ id: string }> {
  const username = normalizedUsername(usernameValue);
  const password = normalizedPassword(passwordValue);
  const now = normalizeNow(nowValue);
  try {
    const row = await db.prepare(
      `SELECT id, password_hash, password_salt, password_iterations, role, disabled, locked_until
       FROM portal_users WHERE username = ? LIMIT 1`,
    ).bind(username).first<UserCredentialRow>();
    if (!row
        || typeof row.id !== "string"
        || !row.id
        || row.role !== "admin"
        || Number(row.disabled ?? 0) !== 0
        || Number(row.locked_until ?? 0) > now
        || typeof row.password_hash !== "string") {
      fail("maintenance_smoke_credentials_invalid", 422, "Maintenance verification credentials are invalid");
    }
    const iterations = Number(row.password_iterations);
    if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) {
      fail("maintenance_smoke_credentials_invalid", 422, "Maintenance verification credentials are invalid");
    }
    const salt = strictBase64(row.password_salt);
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      256,
    ));
    const actual = base64(derived);
    salt.fill(0);
    derived.fill(0);
    if (!constantTimeEqual(actual, row.password_hash)) {
      fail("maintenance_smoke_credentials_invalid", 422, "Maintenance verification credentials are invalid");
    }
    return { id: row.id };
  } catch (error) {
    if (error instanceof MaintenanceVerificationSmokeError) throw error;
    fail("maintenance_smoke_failed", 500, "Maintenance verification failed");
  }
}

function decodeEncryptionKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value.trim()) {
    fail("maintenance_smoke_settings_invalid", 422, "Maintenance settings verification failed");
  }
  const normalized = value.trim();
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    bytes = Uint8Array.from(normalized.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
  } else {
    try {
      bytes = strictBase64(normalized);
    } catch {
      fail("maintenance_smoke_settings_invalid", 422, "Maintenance settings verification failed");
    }
  }
  if (bytes.byteLength !== 32) {
    fail("maintenance_smoke_settings_invalid", 422, "Maintenance settings verification failed");
  }
  return bytes;
}

async function decryptSettingsEnvelope(value: string, keyValue: unknown): Promise<void> {
  if (!value) return;
  if (new TextEncoder().encode(value).byteLength > MAX_SETTINGS_ENVELOPE_BYTES) {
    fail("maintenance_smoke_settings_invalid", 422, "Maintenance settings verification failed");
  }
  const [version, ivValue, ciphertextValue, extra] = value.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue || extra !== undefined) {
    fail("maintenance_smoke_settings_invalid", 422, "Maintenance settings verification failed");
  }
  const keyBytes = decodeEncryptionKey(keyValue);
  try {
    const iv = strictBase64(ivValue);
    const ciphertext = strictBase64(ciphertextValue);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) throw new Error("invalid envelope");
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid plaintext");
    iv.fill(0);
    ciphertext.fill(0);
  } catch (error) {
    if (error instanceof MaintenanceVerificationSmokeError) throw error;
    fail("maintenance_smoke_settings_invalid", 422, "Maintenance settings verification failed");
  } finally {
    keyBytes.fill(0);
  }
}

export async function verifyActiveSettingsDecryption(
  db: D1Database,
  configEncryptionKey: unknown,
): Promise<{ settingsDecryption: "ok" }> {
  try {
    const row = await db.prepare(
      "SELECT encrypted_secrets FROM app_settings WHERE id = 'main' LIMIT 1",
    ).first<{ encrypted_secrets: unknown }>();
    if (row && typeof row.encrypted_secrets !== "string") {
      fail("maintenance_smoke_settings_invalid", 422, "Maintenance settings verification failed");
    }
    await decryptSettingsEnvelope(String(row?.encrypted_secrets ?? ""), configEncryptionKey);
    return { settingsDecryption: "ok" };
  } catch (error) {
    if (error instanceof MaintenanceVerificationSmokeError) throw error;
    fail("maintenance_smoke_failed", 500, "Maintenance verification failed");
  }
}

function resultCount(result: unknown): number {
  if (!result || typeof result !== "object") return -1;
  const values = (result as { results?: unknown }).results;
  if (!Array.isArray(values) || values.length !== 1 || !values[0] || typeof values[0] !== "object") return -1;
  const count = Number((values[0] as { count?: unknown }).count);
  return Number.isSafeInteger(count) && count >= 0 ? count : -1;
}

export async function runAuditAndSessionSmoke(
  db: D1Database,
  context: AuditContext,
  operationId: string,
  now: number,
): Promise<{ auditWrite: "ok"; sessionsRevoked: "ok" }> {
  try {
    const auditId = `audit_${crypto.randomUUID()}`;
    const insert = db.prepare(
      `INSERT INTO portal_audit_events (
        id, created_at, correlation_id, actor_identity, actor_role, actor_groups_json,
        action, resource_type, resource_id, outcome, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      auditId,
      now,
      context.correlationId,
      context.actor.identity,
      context.actor.role,
      JSON.stringify([]),
      "portal.full_restore.verification_smoke",
      "portal_database",
      operationId,
      "success",
      JSON.stringify({ checks: ["administratorAccess", "settingsDecryption", "auditWrite", "sessionsRevoked"] }),
    );
    const readback = db.prepare(
      "SELECT COUNT(*) AS count FROM portal_audit_events WHERE id = ? AND action = ? AND resource_id = ?",
    ).bind(auditId, "portal.full_restore.verification_smoke", operationId);
    const sessions = db.prepare("SELECT COUNT(*) AS count FROM portal_sessions");
    const results = await db.batch([insert, readback, sessions]);
    if (!Array.isArray(results)
        || results.length !== 3
        || resultCount(results[1]) !== 1
        || resultCount(results[2]) !== 0) {
      fail("maintenance_smoke_audit_invalid", 500, "Maintenance audit verification failed");
    }
    return { auditWrite: "ok", sessionsRevoked: "ok" };
  } catch (error) {
    if (error instanceof MaintenanceVerificationSmokeError) throw error;
    fail("maintenance_smoke_failed", 500, "Maintenance verification failed");
  }
}

function validateState(row: MaintenanceRow | null, operationId: string): MaintenanceRow {
  if (!row
      || !["active", "verifying"].includes(row.state)
      || row.operationId !== operationId
      || !row.controllerSecretHash
      || !hashPattern.test(row.controllerSecretHash)) {
    fail("maintenance_transition_invalid", 409, "Maintenance transition is invalid");
  }
  return row;
}

export async function runMaintenanceVerificationSmoke(
  input: MaintenanceVerificationSmokeInput,
  dependencies: SmokeDependencies = {},
): Promise<MaintenanceVerificationSmokeResult> {
  if (!input?.db || typeof input.db.prepare !== "function" || typeof input.db.batch !== "function") {
    fail("maintenance_state_unavailable", 503, "Maintenance state is unavailable");
  }
  if (typeof input.operationId !== "string" || !operationPattern.test(input.operationId)) {
    fail("maintenance_request_invalid", 400, "Maintenance request is invalid");
  }
  if (typeof input.controllerSecret !== "string" || !controllerPattern.test(input.controllerSecret)) {
    fail("maintenance_controller_invalid", 409, "Maintenance controller is invalid");
  }
  const username = normalizedUsername(input.administratorUsername);
  const password = normalizedPassword(input.administratorPassword);
  const now = normalizeNow(input.now);
  try {
    const row = validateState(
      await (dependencies.loadState ?? loadMaintenanceState)(input.db),
      input.operationId,
    );
    const controllerOk = await (dependencies.verifyController ?? verifyMaintenanceControllerSecret)(
      row.controllerSecretHash!,
      input.controllerSecret,
    );
    if (!controllerOk) fail("maintenance_controller_invalid", 409, "Maintenance controller is invalid");
    await (dependencies.verifyAdministrator ?? verifyAdministratorReadOnly)(input.db, username, password, now);
    const settings = await (dependencies.verifySettings ?? verifyActiveSettingsDecryption)(
      input.db,
      input.configEncryptionKey,
    );
    const audit = await (dependencies.auditSmoke ?? runAuditAndSessionSmoke)(
      input.db,
      input.auditContext,
      input.operationId,
      now,
    );
    return {
      operationId: input.operationId,
      checks: {
        administratorAccess: "ok",
        settingsDecryption: settings.settingsDecryption,
        auditWrite: audit.auditWrite,
        sessionsRevoked: audit.sessionsRevoked,
      },
    };
  } catch (error) {
    if (error instanceof MaintenanceVerificationSmokeError) throw error;
    const candidate = error as { code?: unknown; status?: unknown } | null;
    if (typeof candidate?.code === "string" && typeof candidate.status === "number") throw error;
    fail("maintenance_smoke_failed", 500, "Maintenance verification failed");
  }
}
