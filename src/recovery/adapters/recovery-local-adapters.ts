import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, statfs } from "node:fs/promises";

import type { FullBackupDomainPayload, FullBackupTable } from "../../backup/export/backup-full-domains.ts";
import type { FullRestoreSource } from "../foundation/recovery-backup-source.ts";
import { RecoveryError } from "../foundation/recovery-errors.ts";
import { runSqlite, type RecoverySqliteDependencies } from "../foundation/recovery-sqlite.ts";

const hashPattern = /^[a-f0-9]{64}$/u;
const maintenanceOperationPattern = /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const encryptedEnvelopePattern = /^v1\.([A-Za-z0-9+/]+={0,2})\.([A-Za-z0-9+/]+={0,2})$/u;
const MAX_ENVELOPE_BYTES = 20 * 1024 * 1024;

function fail(code: string, message: string, exitCode = 6): never {
  throw new RecoveryError(code, exitCode, message);
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  }
  try {
    const bytes = Uint8Array.from(Buffer.from(value, "base64"));
    if (Buffer.from(bytes).toString("base64") !== value) throw new Error("non-canonical");
    return bytes;
  } catch {
    fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  }
}

function decodePortalEncryptionKey(value: unknown): Uint8Array {
  if (typeof value !== "string") fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  const normalized = value.trim();
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    bytes = Uint8Array.from(normalized.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
  } else {
    bytes = decodeCanonicalBase64(normalized);
  }
  if (bytes.byteLength !== 32) fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  return bytes;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function decryptPortalEnvelope(
  value: unknown,
  configEncryptionKey: unknown,
): Promise<Record<string, unknown>> {
  if (typeof value !== "string"
      || value.length < 1
      || new TextEncoder().encode(value).byteLength > MAX_ENVELOPE_BYTES) {
    fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  }
  const match = encryptedEnvelopePattern.exec(value);
  if (!match) fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  const iv = decodeCanonicalBase64(match[1]);
  const ciphertext = decodeCanonicalBase64(match[2]);
  const keyBytes = decodePortalEncryptionKey(configEncryptionKey);
  if (iv.byteLength !== 12 || ciphertext.byteLength < 16) {
    fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  }
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
    if (!plainObject(parsed)) fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
    return parsed;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  } finally {
    keyBytes.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}

function table(payload: FullBackupDomainPayload | undefined, name: string): FullBackupTable {
  const selected = payload?.tables.find((item) => item.name === name);
  if (!selected) fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  return selected;
}

function columnIndex(tableValue: FullBackupTable, name: string): number {
  const index = tableValue.columns.indexOf(name);
  if (index < 0) fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  return index;
}

async function verifyEncryptedColumn(
  tableValue: FullBackupTable,
  column: string,
  key: string,
): Promise<void> {
  const index = columnIndex(tableValue, column);
  for (const row of tableValue.rows) {
    if (!Array.isArray(row) || row.length !== tableValue.columns.length) {
      fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
    }
    const value = row[index];
    if (value === null || value === "") continue;
    await decryptPortalEnvelope(value, key);
  }
}

export async function verifyRecoveryEncryptedMaterial(
  source: FullRestoreSource,
  configEncryptionKey: string,
): Promise<{ settings: "ok"; replays: "ok"; approvals: "ok" }> {
  try {
    const settings = source.payloads.get("settings");
    for (const name of [
      "app_settings",
      "portal_settings_drafts",
      "portal_settings_apply_commits",
      "portal_settings_revisions",
    ]) {
      await verifyEncryptedColumn(table(settings, name), "encrypted_secrets", configEncryptionKey);
    }
    await verifyEncryptedColumn(
      table(source.payloads.get("operations"), "operation_run_replays"),
      "encrypted_spec",
      configEncryptionKey,
    );
    await verifyEncryptedColumn(
      table(source.payloads.get("approvals"), "operation_approvals"),
      "encrypted_spec",
      configEncryptionKey,
    );
    return { settings: "ok", replays: "ok", approvals: "ok" };
  } catch (error) {
    if (error instanceof RecoveryError && error.code === "recovery_encryption_material_invalid") throw error;
    fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
  }
}

export async function fingerprintRecoveryFile(path: string): Promise<{ sha256: string; bytes: number }> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("invalid file");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (!Number.isSafeInteger(bytes)) throw new Error("oversized");
      hash.update(buffer);
    }
    if (bytes < 1) throw new Error("empty");
    return { sha256: hash.digest("hex"), bytes };
  } catch {
    fail("recovery_filesystem_inspection_failed", "Recovery filesystem inspection failed");
  }
}

export async function statRecoveryDiskSpace(root: string): Promise<{ availableBytes: number }> {
  try {
    const value = await statfs(root, { bigint: true });
    const available = value.bavail * value.bsize;
    if (available < 0n || available > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail("recovery_disk_space_unavailable", "Recovery disk space is unavailable");
    }
    return { availableBytes: Number(available) };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_disk_space_unavailable", "Recovery disk space is unavailable");
  }
}

export async function inspectRecoveryDatabase(
  path: string,
  dependencies: Pick<RecoverySqliteDependencies, "spawnProcess"> & { runSqlite?: typeof runSqlite } = {} as Pick<RecoverySqliteDependencies, "spawnProcess">,
): Promise<{ state: string; currentVersion: number }> {
  try {
    const execute = dependencies.runSqlite ?? runSqlite;
    const result = await execute({
      databasePath: path,
      mode: "read-only",
      script: `SELECT COALESCE(MAX(version), 0) || '|' || (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN ('app_settings','portal_audit_events','portal_maintenance_state','portal_schema_migrations','portal_users')
) FROM portal_schema_migrations;`,
      maxOutputBytes: 65_536,
    }, dependencies.spawnProcess ? { spawnProcess: dependencies.spawnProcess } : {});
    const match = /^(\d+)\|(\d+)$/u.exec(result.stdout.trim());
    const currentVersion = match ? Number(match[1]) : 0;
    const tableCount = match ? Number(match[2]) : 0;
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 1 || tableCount !== 5) {
      fail("recovery_schema_not_ready", "Recovery database schema is not ready");
    }
    return { state: "ready", currentVersion };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_schema_not_ready", "Recovery database schema is not ready");
  }
}

export async function loadRecoveryMaintenance(
  path: string,
  dependencies: Pick<RecoverySqliteDependencies, "spawnProcess"> & { runSqlite?: typeof runSqlite } = {} as Pick<RecoverySqliteDependencies, "spawnProcess">,
): Promise<{ state: string; operationId: string | null; controllerSecretHash: string | null }> {
  try {
    const execute = dependencies.runSqlite ?? runSqlite;
    const result = await execute({
      databasePath: path,
      mode: "read-only",
      script: `SELECT state || '|' || COALESCE(operation_id, '') || '|' || COALESCE(controller_secret_hash, '')
FROM portal_maintenance_state WHERE id = 'main' LIMIT 1;`,
      maxOutputBytes: 65_536,
    }, dependencies.spawnProcess ? { spawnProcess: dependencies.spawnProcess } : {});
    const line = result.stdout.trim();
    const parts = line.split("|");
    if (parts.length !== 3) fail("recovery_maintenance_invalid", "Recovery maintenance state is invalid");
    const [state, operationIdValue, hashValue] = parts;
    const operationId = operationIdValue || null;
    const controllerSecretHash = hashValue || null;
    if (!["active", "verifying", "failed"].includes(state)
        || (operationId !== null && !maintenanceOperationPattern.test(operationId))
        || (controllerSecretHash !== null && !hashPattern.test(controllerSecretHash))) {
      fail("recovery_maintenance_invalid", "Recovery maintenance state is invalid");
    }
    return { state, operationId, controllerSecretHash };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_maintenance_invalid", "Recovery maintenance state is invalid");
  }
}
