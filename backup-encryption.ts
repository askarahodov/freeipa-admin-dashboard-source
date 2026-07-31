import { canonicalBackupJson } from "./backup-manifest.ts";

export const BACKUP_KDF_ITERATIONS = 310_000;
export const MIN_BACKUP_KDF_ITERATIONS = 210_000;
export const MAX_BACKUP_PASSWORD_BYTES = 1_024;
export const MAX_ENCRYPTED_PAYLOAD_BYTES = 20 * 1024 * 1024;
const BACKUP_SALT_BYTES = 16;
const BACKUP_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

export class BackupEncryptionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupEncryptionError";
    this.code = code;
    this.status = status;
  }
}

export type BackupCryptoRandom = {
  randomBytes(length: number): Uint8Array;
};

export type EncryptedPayloadEnvelope = {
  iv: string;
  ciphertext: string;
};

export type BackupPayloadAadContext = {
  format: string;
  version: number;
  schemaVersion: number;
  domain: string;
  path: string;
};

const defaultRandom: BackupCryptoRandom = {
  randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  },
};

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

function strictBase64(value: unknown, code: string, message: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new BackupEncryptionError(code, 422, message);
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (base64Encode(bytes) !== value) throw new Error("non-canonical");
    return bytes;
  } catch {
    throw new BackupEncryptionError(code, 422, message);
  }
}

export function validateBackupPassword(value: unknown): Uint8Array {
  if (typeof value !== "string") {
    throw new BackupEncryptionError("backup_password_invalid", 400, "Backup password is invalid");
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BACKUP_PASSWORD_BYTES) {
    throw new BackupEncryptionError("backup_password_invalid", 400, "Backup password is invalid");
  }
  return bytes;
}

export function createBackupSalt(random: BackupCryptoRandom = defaultRandom): string {
  const bytes = random.randomBytes(BACKUP_SALT_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== BACKUP_SALT_BYTES) {
    throw new BackupEncryptionError("backup_encryption_failed", 500, "Backup encryption failed");
  }
  return base64Encode(bytes);
}

export function createBackupIv(random: BackupCryptoRandom = defaultRandom): string {
  const bytes = random.randomBytes(BACKUP_IV_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== BACKUP_IV_BYTES) {
    throw new BackupEncryptionError("backup_encryption_failed", 500, "Backup encryption failed");
  }
  return base64Encode(bytes);
}

function validateIterations(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < MIN_BACKUP_KDF_ITERATIONS || Number(value) > 10_000_000) {
    throw new BackupEncryptionError("backup_encryption_unsupported", 422, "Backup encryption parameters are unsupported");
  }
  return Number(value);
}

function decodeSalt(value: unknown): Uint8Array {
  const bytes = strictBase64(value, "backup_encryption_unsupported", "Backup encryption parameters are unsupported");
  if (bytes.byteLength < BACKUP_SALT_BYTES || bytes.byteLength > 64) {
    throw new BackupEncryptionError("backup_encryption_unsupported", 422, "Backup encryption parameters are unsupported");
  }
  return bytes;
}

export function validateEncryptedEnvelope(value: unknown): EncryptedPayloadEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackupEncryptionError("backup_envelope_invalid", 422, "Encrypted backup payload is invalid");
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== 2 || !Object.hasOwn(object, "iv") || !Object.hasOwn(object, "ciphertext")) {
    throw new BackupEncryptionError("backup_envelope_invalid", 422, "Encrypted backup payload is invalid");
  }
  const iv = strictBase64(object.iv, "backup_envelope_invalid", "Encrypted backup payload is invalid");
  const ciphertext = strictBase64(object.ciphertext, "backup_envelope_invalid", "Encrypted backup payload is invalid");
  if (iv.byteLength !== BACKUP_IV_BYTES || ciphertext.byteLength < GCM_TAG_BYTES || ciphertext.byteLength > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new BackupEncryptionError("backup_envelope_invalid", 422, "Encrypted backup payload is invalid");
  }
  return { iv: object.iv as string, ciphertext: object.ciphertext as string };
}

export function backupPayloadAad(context: BackupPayloadAadContext): Uint8Array {
  return new TextEncoder().encode(canonicalBackupJson({
    domain: context.domain,
    format: context.format,
    path: context.path,
    schemaVersion: context.schemaVersion,
    version: context.version,
  }));
}

export async function deriveBackupKey(password: unknown, salt: unknown, iterations: unknown): Promise<CryptoKey> {
  const passwordBytes = validateBackupPassword(password);
  const saltBytes = decodeSalt(salt);
  const workFactor = validateIterations(iterations);
  try {
    const material = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: workFactor },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new BackupEncryptionError("backup_encryption_failed", 500, "Backup encryption failed");
  }
}

export async function encryptBackupPayload(input: {
  key: CryptoKey;
  context: BackupPayloadAadContext;
  payload: unknown;
  iv?: string;
  random?: BackupCryptoRandom;
}): Promise<EncryptedPayloadEnvelope> {
  const iv = input.iv ?? createBackupIv(input.random);
  const ivBytes = strictBase64(iv, "backup_encryption_failed", "Backup encryption failed");
  if (ivBytes.byteLength !== BACKUP_IV_BYTES) {
    throw new BackupEncryptionError("backup_encryption_failed", 500, "Backup encryption failed");
  }
  const plaintext = new TextEncoder().encode(canonicalBackupJson(input.payload));
  if (plaintext.byteLength > MAX_ENCRYPTED_PAYLOAD_BYTES - GCM_TAG_BYTES) {
    throw new BackupEncryptionError("backup_payload_too_large", 413, "Backup payload is too large");
  }
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivBytes, additionalData: backupPayloadAad(input.context), tagLength: 128 },
      input.key,
      plaintext,
    );
    return { iv, ciphertext: base64Encode(new Uint8Array(ciphertext)) };
  } catch (error) {
    if (error instanceof BackupEncryptionError) throw error;
    throw new BackupEncryptionError("backup_encryption_failed", 500, "Backup encryption failed");
  }
}

export async function decryptBackupPayload(input: {
  key: CryptoKey;
  context: BackupPayloadAadContext;
  envelope: unknown;
}): Promise<unknown> {
  try {
    const envelope = validateEncryptedEnvelope(input.envelope);
    const iv = strictBase64(envelope.iv, "backup_decryption_failed", "Backup decryption failed");
    const ciphertext = strictBase64(envelope.ciphertext, "backup_decryption_failed", "Backup decryption failed");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: backupPayloadAad(input.context), tagLength: 128 },
      input.key,
      ciphertext,
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    return JSON.parse(text) as unknown;
  } catch {
    throw new BackupEncryptionError("backup_decryption_failed", 422, "Backup decryption failed");
  }
}
