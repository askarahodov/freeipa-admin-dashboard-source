import { randomUUID, timingSafeEqual } from "node:crypto";

import { RecoveryError } from "./recovery-errors.ts";
import {
  decryptPortalEnvelope,
  fingerprintRecoveryFile,
  inspectRecoveryDatabase,
  loadRecoveryMaintenance,
} from "./recovery-local-adapters.ts";
import { validateRecoveryReceipt, type RecoveryReceipt } from "./recovery-receipt.ts";
import { runSqlite, verifySqliteIntegrity } from "./recovery-sqlite.ts";

export type OfflineMaintenanceRecoveryInput = {
  receipt: unknown;
  databasePath: string;
  recoveryPointPath: string;
  confirmation: string;
  administratorUsername: string;
  administratorPassword: string;
  configEncryptionKey: string;
  now?: number;
};

export type OfflineMaintenanceRecoveryResult = Readonly<{
  state: "inactive";
  operationId: string;
  checks: Readonly<{
    recoveryPoint: "ok";
    integrity: "ok";
    schema: "ok";
    administratorAccess: "ok";
    settingsDecryption: "ok";
    auditWrite: "ok";
    sessionsRevoked: "ok";
  }>;
}>;

export type OfflineMaintenanceRecoveryDependencies = {
  fingerprint(path: string): Promise<{ sha256: string; bytes: number }>;
  verifyIntegrity(path: string): Promise<{ integrity: "ok" }>;
  inspectSchema(path: string): Promise<{ state: string; currentVersion: number }>;
  loadMaintenance(path: string): Promise<{ state: string; operationId: string | null; controllerSecretHash: string | null }>;
  verifyAdministrator(path: string, username: string, password: string, now: number): Promise<{ administratorAccess: "ok" }>;
  verifySettings(path: string, configEncryptionKey: string): Promise<{ settingsDecryption: "ok" }>;
  runTransaction(path: string, script: string): Promise<{ changed: number }>;
  verifyResult(path: string, operationId: string): Promise<{ state: string; sessions: number; auditEvents: number }>;
};

const maintenanceOperationPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const allowedReceiptPhases = new Set(["swapped", "failed", "post_complete_failed", "rolled_back"]);
const allowedMaintenanceStates = new Set(["active", "verifying", "exiting", "failed"]);

function fail(code: string, message: string, exitCode = 13): never {
  throw new RecoveryError(code, exitCode, message);
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function exactSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  try {
    return a.byteLength === b.byteLength && timingSafeEqual(a, b);
  } finally {
    a.fill(0);
    b.fill(0);
  }
}

function normalizeNow(value: unknown): number {
  const now = Number(value ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 1) {
    fail("recovery_maintenance_request_invalid", "Offline maintenance recovery request is invalid", 2);
  }
  return now;
}

function strictBase64(value: string): Uint8Array {
  if (!value
      || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail("recovery_maintenance_credentials_invalid", "Offline maintenance credentials are invalid");
  }
  try {
    const bytes = Uint8Array.from(Buffer.from(value, "base64"));
    if (Buffer.from(bytes).toString("base64") !== value) throw new Error("non-canonical");
    return bytes;
  } catch {
    fail("recovery_maintenance_credentials_invalid", "Offline maintenance credentials are invalid");
  }
}

function constantTimeText(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  let difference = a.byteLength ^ b.byteLength;
  for (let index = 0; index < Math.max(a.byteLength, b.byteLength); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  a.fill(0);
  b.fill(0);
  return difference === 0;
}

async function verifyAdministrator(
  path: string,
  usernameValue: string,
  password: string,
  now: number,
): Promise<{ administratorAccess: "ok" }> {
  const username = usernameValue.trim().toLowerCase();
  if (!usernamePattern.test(username) || password.length < 1 || password.length > 256) {
    fail("recovery_maintenance_credentials_invalid", "Offline maintenance credentials are invalid");
  }
  try {
    const result = await runSqlite({
      databasePath: path,
      mode: "read-only",
      script: `SELECT id || '|' || password_hash || '|' || password_salt || '|' || password_iterations || '|' || role || '|' || disabled || '|' || COALESCE(locked_until, 0)
FROM portal_users WHERE username = ${sqlLiteral(username)} LIMIT 1;`,
      maxOutputBytes: 65_536,
    });
    const parts = result.stdout.trim().split("|");
    if (parts.length !== 7
        || !parts[0]
        || parts[4] !== "admin"
        || parts[5] !== "0"
        || Number(parts[6]) > now) {
      fail("recovery_maintenance_credentials_invalid", "Offline maintenance credentials are invalid");
    }
    const iterations = Number(parts[3]);
    if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) {
      fail("recovery_maintenance_credentials_invalid", "Offline maintenance credentials are invalid");
    }
    const salt = strictBase64(parts[2]);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      256,
    ));
    const actual = Buffer.from(derived).toString("base64");
    salt.fill(0);
    derived.fill(0);
    if (!constantTimeText(actual, parts[1])) {
      fail("recovery_maintenance_credentials_invalid", "Offline maintenance credentials are invalid");
    }
    return { administratorAccess: "ok" };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_maintenance_failed", "Offline maintenance recovery failed");
  }
}

async function verifySettings(
  path: string,
  configEncryptionKey: string,
): Promise<{ settingsDecryption: "ok" }> {
  try {
    const result = await runSqlite({
      databasePath: path,
      mode: "read-only",
      script: "SELECT encrypted_secrets FROM app_settings WHERE id = 'main' LIMIT 1;",
      maxOutputBytes: 20 * 1024 * 1024,
    });
    const envelope = result.stdout.replace(/\r?\n$/u, "");
    if (envelope) await decryptPortalEnvelope(envelope, configEncryptionKey);
    return { settingsDecryption: "ok" };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_maintenance_failed", "Offline maintenance recovery failed");
  }
}

export function buildOfflineMaintenanceRecoveryScript(input: {
  maintenanceOperationId: string;
  auditId: string;
  now: number;
}): string {
  if (!maintenanceOperationPattern.test(input.maintenanceOperationId)
      || typeof input.auditId !== "string"
      || !input.auditId
      || input.auditId.length > 255
      || !Number.isSafeInteger(input.now)
      || input.now < 1) {
    fail("recovery_maintenance_request_invalid", "Offline maintenance recovery request is invalid", 2);
  }
  const operation = sqlLiteral(input.maintenanceOperationId);
  const auditId = sqlLiteral(input.auditId);
  const metadata = sqlLiteral(JSON.stringify({ recovery: "offline", checks: "verified" }));
  return `PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
UPDATE portal_maintenance_state
SET state = 'inactive', operation_id = NULL, actor_identity = NULL, actor_groups_json = '[]',
    controller_secret_hash = NULL, updated_at = ${input.now}, expires_at = NULL,
    completed_at = ${input.now}, failure_code = NULL, verification_json = '{"offlineRecovery":"ok"}'
WHERE id = 'main' AND operation_id = ${operation}
  AND state IN ('active','verifying','exiting','failed');
SELECT 'changed|' || changes();
DELETE FROM portal_sessions;
INSERT INTO portal_audit_events (
  id, created_at, correlation_id, actor_identity, actor_role, actor_groups_json,
  action, resource_type, resource_id, event_id, schema_version, approval_id,
  run_id, job_id, outcome, error_code, metadata_json
) VALUES (
  ${auditId}, ${input.now}, ${operation}, 'offline-recovery@portal.local', 'admin', '[]',
  'portal.maintenance.offline_recovered', 'portal_database', ${operation}, NULL, NULL, NULL,
  NULL, NULL, 'success', NULL, ${metadata}
);
COMMIT;
`;
}

async function runTransaction(path: string, script: string): Promise<{ changed: number }> {
  try {
    const result = await runSqlite({
      databasePath: path,
      mode: "read-write",
      script,
      maxOutputBytes: 65_536,
    }, { timeoutMs: 300_000 });
    const match = /^changed\|(\d+)$/mu.exec(result.stdout);
    const changed = match ? Number(match[1]) : -1;
    if (changed !== 1) fail("recovery_maintenance_state_invalid", "Offline maintenance state is invalid");
    return { changed };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_maintenance_failed", "Offline maintenance recovery failed");
  }
}

async function verifyResult(path: string, operationId: string): Promise<{ state: string; sessions: number; auditEvents: number }> {
  try {
    const result = await runSqlite({
      databasePath: path,
      mode: "read-only",
      script: `SELECT state || '|' || (SELECT count(*) FROM portal_sessions) || '|' ||
  (SELECT count(*) FROM portal_audit_events WHERE action = 'portal.maintenance.offline_recovered' AND resource_id = ${sqlLiteral(operationId)})
FROM portal_maintenance_state WHERE id = 'main' LIMIT 1;`,
      maxOutputBytes: 65_536,
    });
    const match = /^([^|]+)\|(\d+)\|(\d+)$/u.exec(result.stdout.trim());
    if (!match) fail("recovery_maintenance_result_invalid", "Offline maintenance recovery result is invalid");
    return { state: match[1], sessions: Number(match[2]), auditEvents: Number(match[3]) };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_maintenance_failed", "Offline maintenance recovery failed");
  }
}

function defaultDependencies(): OfflineMaintenanceRecoveryDependencies {
  return {
    fingerprint: fingerprintRecoveryFile,
    verifyIntegrity: verifySqliteIntegrity,
    inspectSchema: inspectRecoveryDatabase,
    loadMaintenance: loadRecoveryMaintenance,
    verifyAdministrator,
    verifySettings,
    runTransaction,
    verifyResult,
  };
}

export async function recoverFailedMaintenanceOffline(
  input: OfflineMaintenanceRecoveryInput,
  dependencyValue: Partial<OfflineMaintenanceRecoveryDependencies> = {},
): Promise<OfflineMaintenanceRecoveryResult> {
  const receipt = validateRecoveryReceipt(input?.receipt);
  const now = normalizeNow(input?.now);
  if (!allowedReceiptPhases.has(receipt.phase)
      || typeof input.databasePath !== "string"
      || typeof input.recoveryPointPath !== "string"
      || typeof input.confirmation !== "string"
      || typeof input.administratorUsername !== "string"
      || typeof input.administratorPassword !== "string"
      || typeof input.configEncryptionKey !== "string") {
    fail("recovery_maintenance_request_invalid", "Offline maintenance recovery request is invalid", 2);
  }
  const expectedConfirmation = `RECOVER FAILED MAINTENANCE ${receipt.maintenanceOperationId}`;
  if (!exactSecret(input.confirmation, expectedConfirmation)) {
    fail("recovery_maintenance_confirmation_invalid", "Offline maintenance confirmation is invalid");
  }
  const dependencies = { ...defaultDependencies(), ...dependencyValue } as OfflineMaintenanceRecoveryDependencies;
  try {
    const point = await dependencies.fingerprint(input.recoveryPointPath);
    if (point.sha256 !== receipt.recoveryPointSha256 || point.bytes !== receipt.recoveryPointBytes) {
      fail("recovery_point_binding_invalid", "Recovery point binding is invalid");
    }
    await dependencies.verifyIntegrity(input.databasePath);
    const schema = await dependencies.inspectSchema(input.databasePath);
    if (schema.state !== "ready" || schema.currentVersion !== receipt.schemaVersion) {
      fail("recovery_maintenance_schema_invalid", "Offline maintenance schema is invalid");
    }
    const maintenance = await dependencies.loadMaintenance(input.databasePath);
    if (!allowedMaintenanceStates.has(maintenance.state)
        || maintenance.operationId !== receipt.maintenanceOperationId) {
      fail("recovery_maintenance_state_invalid", "Offline maintenance state is invalid");
    }
    const administrator = await dependencies.verifyAdministrator(
      input.databasePath,
      input.administratorUsername,
      input.administratorPassword,
      now,
    );
    const settings = await dependencies.verifySettings(input.databasePath, input.configEncryptionKey);
    const script = buildOfflineMaintenanceRecoveryScript({
      maintenanceOperationId: receipt.maintenanceOperationId,
      auditId: `audit_${randomUUID()}`,
      now,
    });
    const transaction = await dependencies.runTransaction(input.databasePath, script);
    if (transaction.changed !== 1) fail("recovery_maintenance_state_invalid", "Offline maintenance state is invalid");
    const result = await dependencies.verifyResult(input.databasePath, receipt.maintenanceOperationId);
    if (result.state !== "inactive" || result.sessions !== 0 || result.auditEvents !== 1) {
      fail("recovery_maintenance_result_invalid", "Offline maintenance recovery result is invalid");
    }
    return Object.freeze({
      state: "inactive",
      operationId: receipt.maintenanceOperationId,
      checks: Object.freeze({
        recoveryPoint: "ok",
        integrity: "ok",
        schema: "ok",
        administratorAccess: administrator.administratorAccess,
        settingsDecryption: settings.settingsDecryption,
        auditWrite: "ok",
        sessionsRevoked: "ok",
      }),
    });
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_maintenance_failed", "Offline maintenance recovery failed");
  }
}
