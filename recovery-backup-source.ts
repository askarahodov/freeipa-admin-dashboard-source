import {
  canonicalBackupJson,
  PORTAL_BACKUP_DOMAINS,
  sha256Hex,
  type PortalBackupDomain,
} from "./src/backup/backup-manifest.ts";
import {
  decryptEncryptedBackupDomains,
  validateEncryptedBackupDocument,
} from "./src/backup/preview/backup-encrypted-preview.ts";
import {
  FULL_BACKUP_TABLES,
  type FullBackupDomainPayload,
  type FullBackupTable,
} from "./src/backup/export/backup-full-domains.ts";
import { RecoveryError } from "./recovery-errors.ts";

export type FullRestoreSource = Readonly<{
  manifestSha256: string;
  sourceSchemaVersion: number;
  domains: readonly PortalBackupDomain[];
  payloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>;
  tableCounts: Readonly<Record<string, number>>;
  totalRecords: number;
  documentBytes: number;
}>;

const MIN_PASSWORD_ITERATIONS = 210_000;
const MAX_PASSWORD_ITERATIONS = 1_000_000;
const MAX_PASSWORD_BYTES = 1_024;

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string, message: string, exitCode = 5): never {
  throw new RecoveryError(code, exitCode, message);
}

function fullBackupRequired(): never {
  fail("recovery_full_backup_required", "A complete encrypted portal backup is required", 2);
}

function backupDecryptionFailed(): never {
  fail("recovery_backup_decryption_failed", "Encrypted portal backup validation failed", 5);
}

function domainsAreCanonical(value: unknown): value is PortalBackupDomain[] {
  return Array.isArray(value)
    && value.length === PORTAL_BACKUP_DOMAINS.length
    && value.every((domain, index) => domain === PORTAL_BACKUP_DOMAINS[index]);
}

function tableByName(payload: FullBackupDomainPayload, name: string): FullBackupTable {
  const table = payload.tables.find((item) => item.name === name);
  if (!table) backupDecryptionFailed();
  return table;
}

function frozenCounts(payloads: ReadonlyMap<PortalBackupDomain, FullBackupDomainPayload>): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [domain, definitions] of FULL_BACKUP_TABLES) {
    const payload = payloads.get(domain);
    if (!payload) backupDecryptionFailed();
    for (const definition of definitions) {
      if (Object.hasOwn(counts, definition.name)) backupDecryptionFailed();
      counts[definition.name] = tableByName(payload, definition.name).rows.length;
    }
  }
  return Object.freeze(counts);
}

export async function loadFullRestoreSource(
  documentValue: unknown,
  password: unknown,
): Promise<FullRestoreSource> {
  if (!plainObject(documentValue)
      || !plainObject(documentValue.manifest)
      || documentValue.manifest.mode !== "encrypted"
      || !plainObject(documentValue.manifest.encryption)
      || !domainsAreCanonical(documentValue.manifest.domains)) {
    fullBackupRequired();
  }

  try {
    const document = await validateEncryptedBackupDocument(documentValue);
    if (document.manifest.mode !== "encrypted"
        || !document.manifest.encryption
        || !domainsAreCanonical(document.manifest.domains)) {
      fullBackupRequired();
    }
    const decrypted = await decryptEncryptedBackupDomains(document, password, undefined);
    if (!domainsAreCanonical(decrypted.selectedDomains)
        || decrypted.fullPayloads.size !== PORTAL_BACKUP_DOMAINS.length) {
      fullBackupRequired();
    }

    const payloads = new Map<PortalBackupDomain, FullBackupDomainPayload>();
    for (const domain of PORTAL_BACKUP_DOMAINS) {
      const payload = decrypted.fullPayloads.get(domain);
      if (!payload || payload.domain !== domain || payload.schemaVersion !== document.manifest.schemaVersion) {
        backupDecryptionFailed();
      }
      payloads.set(domain, payload);
    }
    const tableCounts = frozenCounts(payloads);
    const totalRecords = Object.values(tableCounts).reduce((total, count) => total + count, 0);
    if (!Number.isSafeInteger(totalRecords) || totalRecords < 0) backupDecryptionFailed();
    const canonicalDocument = canonicalBackupJson(document);
    const source: FullRestoreSource = {
      manifestSha256: await sha256Hex(canonicalBackupJson(document.manifest)),
      sourceSchemaVersion: document.manifest.schemaVersion,
      domains: Object.freeze([...PORTAL_BACKUP_DOMAINS]),
      payloads,
      tableCounts,
      totalRecords,
      documentBytes: new TextEncoder().encode(canonicalDocument).byteLength,
    };
    return Object.freeze(source);
  } catch (error) {
    if (error instanceof RecoveryError && error.code === "recovery_full_backup_required") throw error;
    backupDecryptionFailed();
  }
}

function canonicalBase64(value: unknown, expectedBytes?: number): Uint8Array | null {
  if (typeof value !== "string"
      || !value.length
      || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      encoded += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    if (btoa(encoded) !== value || (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)) return null;
    return bytes;
  } catch {
    return null;
  }
}

function fixedLoopEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.byteLength, right.byteLength);
  let difference = left.byteLength ^ right.byteLength;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function columnIndex(table: FullBackupTable, name: string): number {
  const index = table.columns.indexOf(name);
  if (index < 0) fail("recovery_administrator_invalid", "Recovery administrator credentials are invalid", 6);
  return index;
}

export async function verifyBackupAdministrator(
  source: FullRestoreSource,
  username: unknown,
  password: unknown,
  now = Date.now(),
): Promise<{ userId: string; username: string }> {
  try {
    if (!source || typeof source !== "object"
        || typeof username !== "string"
        || !username.length
        || username.length > 255
        || typeof password !== "string"
        || !Number.isSafeInteger(now)
        || now < 0) {
      throw new Error("invalid");
    }
    const passwordBytes = new TextEncoder().encode(password);
    if (passwordBytes.byteLength < 1 || passwordBytes.byteLength > MAX_PASSWORD_BYTES) throw new Error("invalid");
    const payload = source.payloads.get("local-auth");
    if (!payload) throw new Error("invalid");
    const users = tableByName(payload, "portal_users");
    const idIndex = columnIndex(users, "id");
    const usernameIndex = columnIndex(users, "username");
    const hashIndex = columnIndex(users, "password_hash");
    const saltIndex = columnIndex(users, "password_salt");
    const iterationsIndex = columnIndex(users, "password_iterations");
    const roleIndex = columnIndex(users, "role");
    const disabledIndex = columnIndex(users, "disabled");
    const lockedUntilIndex = columnIndex(users, "locked_until");
    const row = users.rows.find((item) => item[usernameIndex] === username);
    if (!row
        || typeof row[idIndex] !== "string"
        || !row[idIndex]
        || row[roleIndex] !== "admin"
        || row[disabledIndex] !== 0
        || (row[lockedUntilIndex] !== null
          && (typeof row[lockedUntilIndex] !== "number" || !Number.isFinite(row[lockedUntilIndex]) || row[lockedUntilIndex] > now))) {
      throw new Error("invalid");
    }
    const storedHash = canonicalBase64(row[hashIndex], 32);
    const salt = canonicalBase64(row[saltIndex]);
    const iterations = row[iterationsIndex];
    if (!storedHash
        || !salt
        || salt.byteLength < 16
        || salt.byteLength > 64
        || !Number.isSafeInteger(iterations)
        || Number(iterations) < MIN_PASSWORD_ITERATIONS
        || Number(iterations) > MAX_PASSWORD_ITERATIONS) {
      throw new Error("invalid");
    }
    const material = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: Number(iterations),
    }, material, 256));
    if (!fixedLoopEqual(derived, storedHash)) throw new Error("invalid");
    return { userId: row[idIndex] as string, username };
  } catch {
    fail("recovery_administrator_invalid", "Recovery administrator credentials are invalid", 6);
  }
}
