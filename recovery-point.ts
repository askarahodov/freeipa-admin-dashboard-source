import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { lstat, open, realpath, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { RecoveryError } from "./recovery-errors.ts";
import {
  createRecoveryReceipt,
  writeRecoveryReceiptAtomic,
  type RecoveryReceipt,
} from "./recovery-receipt.ts";
import {
  backupSqliteDatabase,
  checkpointSqlite,
  runSqlite,
  verifySqliteIntegrity,
} from "./recovery-sqlite.ts";

const magic = Buffer.alloc(32);
magic.write("PORTAL-RECOVERY-SQLITE-V1", 0, "ascii");
export const RECOVERY_POINT_MAGIC = Buffer.from(magic);

export type RecoveryPointHeader = Readonly<{
  format: "portal-recovery-sqlite-v1";
  version: 1;
  algorithm: "AES-256-GCM";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  createdAt: string;
  plaintextBytes: number;
  plaintextSha256: string;
}>;

export type RecoveryPointEncryptionResult = Readonly<{
  header: RecoveryPointHeader;
  artifactSha256: string;
  artifactBytes: number;
}>;

export type RecoveryPointDecryptionResult = Readonly<{
  header: RecoveryPointHeader;
  plaintextSha256: string;
  plaintextBytes: number;
}>;

export type RecoveryPointPreflight = Readonly<{
  database: Readonly<{
    relativePath: string;
    sha256: string;
    bytes: number;
    schemaVersion: number;
  }>;
  maintenance: Readonly<{
    state: string;
    operationId: string;
  }>;
  backup: Readonly<{
    manifestSha256: string;
    sourceSchemaVersion: number;
    domains: number;
    tables: number;
    records: number;
    documentBytes: number;
  }>;
}>;

export type RecoveryPointDependencies = {
  createTemporaryPath(root: string, purpose: "source" | "verify"): Promise<string>;
  checkpoint(path: string): Promise<{ checkpoint: "ok"; busy: number; logFrames: number; checkpointedFrames: number }>;
  backup(source: string, destination: string): Promise<{ backup: "ok" }>;
  verifyIntegrity(path: string): Promise<{ integrity: "ok" }>;
  verifySchema(path: string, version: number): Promise<{ schema: "ok" }>;
  fingerprint(path: string): Promise<{ sha256: string; bytes: number }>;
  encrypt(input: {
    sourcePath: string;
    destinationPath: string;
    password: string;
    createdAt?: string;
  }): Promise<RecoveryPointEncryptionResult>;
  decrypt(input: {
    sourcePath: string;
    destinationPath: string;
    password: string;
  }): Promise<RecoveryPointDecryptionResult>;
  remove(path: string): Promise<void>;
  writeReceipt(path: string, receipt: RecoveryReceipt): Promise<RecoveryReceipt>;
};

const HEADER_LIMIT = 16_384;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const DEFAULT_ITERATIONS = 310_000;
const MIN_ITERATIONS = 210_000;
const MAX_ITERATIONS = 1_000_000;
const MAX_PASSWORD_BYTES = 1_024;
const MAX_PATH_BYTES = 4_096;

function fail(code: string, message: string, exitCode = 8): never {
  throw new RecoveryError(code, exitCode, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateAbsolutePath(value: unknown): string {
  if (typeof value !== "string"
      || !value
      || !isAbsolute(value)
      || value.includes("\0")
      || byteLength(value) > MAX_PATH_BYTES) {
    fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
  }
  return value;
}

async function validateSource(path: string): Promise<{ path: string; bytes: number }> {
  const source = validateAbsolutePath(path);
  try {
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
      fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
    }
    const canonical = await realpath(source);
    if (canonical !== source) fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
    return { path: source, bytes: metadata.size };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
  }
}

async function validateDestination(path: string): Promise<string> {
  const destination = validateAbsolutePath(path);
  try {
    const parent = await lstat(dirname(destination));
    if (parent.isSymbolicLink() || !parent.isDirectory()) {
      fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
    }
    try {
      await lstat(destination);
      fail("recovery_point_destination_exists", "Recovery point destination already exists", 2);
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
      }
    }
    return destination;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
  }
}

function validatePassword(value: unknown): Buffer {
  if (typeof value !== "string") fail("recovery_point_password_invalid", "Recovery point password is invalid", 2);
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PASSWORD_BYTES) {
    bytes.fill(0);
    fail("recovery_point_password_invalid", "Recovery point password is invalid", 2);
  }
  return bytes;
}

function canonicalBase64(value: unknown, expectedBytes: number): Buffer | null {
  if (typeof value !== "string"
      || !value.length
      || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.byteLength === expectedBytes && bytes.toString("base64") === value ? bytes : null;
  } catch {
    return null;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validateIterations(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < MIN_ITERATIONS || Number(value) > MAX_ITERATIONS) {
    fail("recovery_point_encryption_parameters_invalid", "Recovery point encryption parameters are invalid", 2);
  }
  return Number(value);
}

function validateHeader(value: unknown, canonicalText?: string): RecoveryPointHeader {
  const keys = [
    "algorithm",
    "createdAt",
    "format",
    "iterations",
    "iv",
    "kdf",
    "plaintextBytes",
    "plaintextSha256",
    "salt",
    "version",
  ].sort();
  if (!plainObject(value)
      || Object.keys(value).sort().some((key, index, all) => all.length !== keys.length || key !== keys[index])
      || value.format !== "portal-recovery-sqlite-v1"
      || value.version !== 1
      || value.algorithm !== "AES-256-GCM"
      || value.kdf !== "PBKDF2-SHA-256"
      || !Number.isSafeInteger(value.iterations)
      || Number(value.iterations) < MIN_ITERATIONS
      || Number(value.iterations) > MAX_ITERATIONS
      || !canonicalBase64(value.salt, SALT_BYTES)
      || !canonicalBase64(value.iv, IV_BYTES)
      || !validTimestamp(value.createdAt)
      || !Number.isSafeInteger(value.plaintextBytes)
      || Number(value.plaintextBytes) < 1
      || typeof value.plaintextSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(value.plaintextSha256)) {
    fail("recovery_point_decryption_failed", "Recovery point decryption failed");
  }
  const header: RecoveryPointHeader = Object.freeze({
    format: "portal-recovery-sqlite-v1",
    version: 1,
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: Number(value.iterations),
    salt: value.salt as string,
    iv: value.iv as string,
    createdAt: value.createdAt as string,
    plaintextBytes: Number(value.plaintextBytes),
    plaintextSha256: value.plaintextSha256 as string,
  });
  if (canonicalText !== undefined && canonicalJson(header) !== canonicalText) {
    fail("recovery_point_decryption_failed", "Recovery point decryption failed");
  }
  return header;
}

async function fingerprintFile(path: string): Promise<{ sha256: string; bytes: number }> {
  await validateSource(path);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    hash.update(buffer);
  }
  if (!Number.isSafeInteger(bytes) || bytes < 1) fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
  return { sha256: hash.digest("hex"), bytes };
}

function deriveKey(password: Buffer, salt: Buffer, iterations: number): Buffer {
  try {
    return pbkdf2Sync(password, salt, iterations, 32, "sha256");
  } catch {
    fail("recovery_point_encryption_failed", "Recovery point encryption failed");
  }
}

async function syncFile(path: string): Promise<void> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function encryptRecoveryPointFile(input: {
  sourcePath: string;
  destinationPath: string;
  password: string;
  createdAt?: string;
  iterations?: number;
  salt?: string;
  iv?: string;
}): Promise<RecoveryPointEncryptionResult> {
  if (!plainObject(input)) fail("recovery_point_path_invalid", "Recovery point path is invalid", 2);
  const source = await validateSource(input.sourcePath);
  const destination = await validateDestination(input.destinationPath);
  const password = validatePassword(input.password);
  const iterations = validateIterations(input.iterations ?? DEFAULT_ITERATIONS);
  const salt = input.salt === undefined ? randomBytes(SALT_BYTES) : canonicalBase64(input.salt, SALT_BYTES);
  const iv = input.iv === undefined ? randomBytes(IV_BYTES) : canonicalBase64(input.iv, IV_BYTES);
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!salt || !iv || !validTimestamp(createdAt)) {
    password.fill(0);
    fail("recovery_point_encryption_parameters_invalid", "Recovery point encryption parameters are invalid", 2);
  }

  let key: Buffer | null = null;
  try {
    const plaintext = await fingerprintFile(source.path);
    if (plaintext.bytes !== source.bytes) fail("recovery_point_encryption_failed", "Recovery point encryption failed");
    const header = validateHeader({
      format: "portal-recovery-sqlite-v1",
      version: 1,
      algorithm: "AES-256-GCM",
      kdf: "PBKDF2-SHA-256",
      iterations,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      createdAt,
      plaintextBytes: plaintext.bytes,
      plaintextSha256: plaintext.sha256,
    });
    const headerBytes = Buffer.from(canonicalJson(header), "utf8");
    if (headerBytes.byteLength < 1 || headerBytes.byteLength > HEADER_LIMIT) {
      fail("recovery_point_encryption_failed", "Recovery point encryption failed");
    }
    const prefix = Buffer.alloc(RECOVERY_POINT_MAGIC.byteLength + 4 + headerBytes.byteLength);
    RECOVERY_POINT_MAGIC.copy(prefix, 0);
    prefix.writeUInt32BE(headerBytes.byteLength, RECOVERY_POINT_MAGIC.byteLength);
    headerBytes.copy(prefix, RECOVERY_POINT_MAGIC.byteLength + 4);

    key = deriveKey(password, salt, iterations);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(headerBytes);
    const tagAppender = new Transform({
      transform(chunk, _encoding, callback) { callback(null, chunk); },
      flush(callback) {
        try {
          this.push(cipher.getAuthTag());
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    });
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    output.write(prefix);
    await pipeline(createReadStream(source.path), cipher, tagAppender, output);
    await syncFile(destination);
    const artifact = await fingerprintFile(destination);
    const expectedBytes = prefix.byteLength + plaintext.bytes + TAG_BYTES;
    if (artifact.bytes !== expectedBytes) fail("recovery_point_encryption_failed", "Recovery point encryption failed");
    return Object.freeze({ header, artifactSha256: artifact.sha256, artifactBytes: artifact.bytes });
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    fail("recovery_point_encryption_failed", "Recovery point encryption failed");
  } finally {
    password.fill(0);
    key?.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

async function readEnvelope(path: string): Promise<{
  header: RecoveryPointHeader;
  headerBytes: Buffer;
  cipherStart: number;
  cipherEnd: number;
  tag: Buffer;
}> {
  const source = await validateSource(path);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(source.path, constants.O_RDONLY | noFollow);
  try {
    const fixed = Buffer.alloc(RECOVERY_POINT_MAGIC.byteLength + 4);
    const fixedRead = await handle.read(fixed, 0, fixed.byteLength, 0);
    if (fixedRead.bytesRead !== fixed.byteLength
        || !fixed.subarray(0, RECOVERY_POINT_MAGIC.byteLength).equals(RECOVERY_POINT_MAGIC)) {
      fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    }
    const headerLength = fixed.readUInt32BE(RECOVERY_POINT_MAGIC.byteLength);
    if (headerLength < 1 || headerLength > HEADER_LIMIT) fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    const headerBytes = Buffer.alloc(headerLength);
    const headerRead = await handle.read(headerBytes, 0, headerLength, fixed.byteLength);
    if (headerRead.bytesRead !== headerLength) fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    let parsed: unknown;
    const headerText = headerBytes.toString("utf8");
    try {
      parsed = JSON.parse(headerText) as unknown;
    } catch {
      fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    }
    const header = validateHeader(parsed, headerText);
    const cipherStart = fixed.byteLength + headerLength;
    const cipherEnd = source.bytes - TAG_BYTES - 1;
    if (cipherEnd < cipherStart || cipherEnd - cipherStart + 1 !== header.plaintextBytes) {
      fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    }
    const tag = Buffer.alloc(TAG_BYTES);
    const tagRead = await handle.read(tag, 0, TAG_BYTES, source.bytes - TAG_BYTES);
    if (tagRead.bytesRead !== TAG_BYTES) fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    return { header, headerBytes, cipherStart, cipherEnd, tag };
  } finally {
    await handle.close();
  }
}

export async function decryptRecoveryPointFile(input: {
  sourcePath: string;
  destinationPath: string;
  password: string;
}): Promise<RecoveryPointDecryptionResult> {
  if (!plainObject(input)) fail("recovery_point_decryption_failed", "Recovery point decryption failed");
  const source = await validateSource(input.sourcePath).catch(() => fail("recovery_point_decryption_failed", "Recovery point decryption failed"));
  const destination = await validateDestination(input.destinationPath);
  const password = validatePassword(input.password);
  let key: Buffer | null = null;
  let salt: Buffer | null = null;
  let iv: Buffer | null = null;
  try {
    const envelope = await readEnvelope(source.path);
    salt = canonicalBase64(envelope.header.salt, SALT_BYTES);
    iv = canonicalBase64(envelope.header.iv, IV_BYTES);
    if (!salt || !iv) fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    key = deriveKey(password, salt, envelope.header.iterations);
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(envelope.headerBytes);
    decipher.setAuthTag(envelope.tag);
    const hash = createHash("sha256");
    let plaintextBytes = 0;
    const tracker = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        plaintextBytes += chunk.byteLength;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      createReadStream(source.path, { start: envelope.cipherStart, end: envelope.cipherEnd }),
      decipher,
      tracker,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
    await syncFile(destination);
    const plaintextSha256 = hash.digest("hex");
    if (plaintextBytes !== envelope.header.plaintextBytes
        || plaintextSha256 !== envelope.header.plaintextSha256) {
      fail("recovery_point_decryption_failed", "Recovery point decryption failed");
    }
    return Object.freeze({ header: envelope.header, plaintextSha256, plaintextBytes });
  } catch {
    await rm(destination, { force: true }).catch(() => undefined);
    fail("recovery_point_decryption_failed", "Recovery point decryption failed");
  } finally {
    password.fill(0);
    key?.fill(0);
    salt?.fill(0);
    iv?.fill(0);
  }
}

async function verifySchemaDefault(path: string, expectedVersion: number): Promise<{ schema: "ok" }> {
  const result = await runSqlite({
    databasePath: path,
    mode: "read-only",
    script: [
      "SELECT COALESCE(MAX(version), 0) FROM portal_schema_migrations;",
      "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('app_settings','portal_audit_events','portal_maintenance_state','portal_schema_migrations','portal_users');",
    ].join("\n"),
    maxOutputBytes: 65_536,
  });
  const values = result.stdout.trim().split(/\r?\n/u).map(Number);
  if (values.length !== 2 || values[0] !== expectedVersion || values[1] !== 5) {
    fail("recovery_point_schema_failed", "Recovery point schema verification failed");
  }
  return { schema: "ok" };
}

function contained(root: string, child: string): boolean {
  const offset = relative(root, child);
  return offset !== "" && !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validateCreationInput(input: unknown): asserts input is {
  liveDatabasePath: string;
  artifactRoot: string;
  recoveryPointPath: string;
  receiptPath: string;
  recoveryPassword: string;
  operationId: string;
  createdAt: string;
  preflight: RecoveryPointPreflight;
} {
  if (!plainObject(input)
      || !plainObject(input.preflight)
      || !plainObject(input.preflight.database)
      || !plainObject(input.preflight.maintenance)
      || !plainObject(input.preflight.backup)
      || typeof input.liveDatabasePath !== "string"
      || typeof input.artifactRoot !== "string"
      || typeof input.recoveryPointPath !== "string"
      || typeof input.receiptPath !== "string"
      || typeof input.recoveryPassword !== "string"
      || typeof input.operationId !== "string"
      || typeof input.createdAt !== "string") {
    fail("recovery_point_creation_failed", "Recovery point creation failed");
  }
}

function defaultDependencies(operationId: string): RecoveryPointDependencies {
  return {
    async createTemporaryPath(root, purpose) {
      return join(root, `.${operationId}.${purpose}.${randomUUID()}.sqlite`);
    },
    checkpoint: checkpointSqlite,
    backup: backupSqliteDatabase,
    verifyIntegrity: verifySqliteIntegrity,
    verifySchema: verifySchemaDefault,
    fingerprint: fingerprintFile,
    encrypt: encryptRecoveryPointFile,
    decrypt: decryptRecoveryPointFile,
    async remove(path) { await rm(path, { force: true }); },
    async writeReceipt(path, receipt) { return writeRecoveryReceiptAtomic(path, receipt); },
  };
}

export async function createRecoveryPoint(
  inputValue: unknown,
  suppliedDependencies: Partial<RecoveryPointDependencies> = {},
): Promise<RecoveryReceipt> {
  validateCreationInput(inputValue);
  const input = inputValue;
  const dependencies = { ...defaultDependencies(input.operationId), ...suppliedDependencies } as RecoveryPointDependencies;
  const required = [
    "createTemporaryPath", "checkpoint", "backup", "verifyIntegrity", "verifySchema",
    "fingerprint", "encrypt", "decrypt", "remove", "writeReceipt",
  ] as const;
  if (required.some((name) => typeof dependencies[name] !== "function")) {
    fail("recovery_point_creation_failed", "Recovery point creation failed");
  }

  let sourceTemp = "";
  let verifyTemp = "";
  try {
    const artifactRoot = validateAbsolutePath(input.artifactRoot);
    const recoveryPointPath = validateAbsolutePath(input.recoveryPointPath);
    const receiptPath = validateAbsolutePath(input.receiptPath);
    if (!contained(artifactRoot, recoveryPointPath) || !contained(artifactRoot, receiptPath)) {
      fail("recovery_point_creation_failed", "Recovery point creation failed");
    }
    const database = input.preflight.database;
    const maintenance = input.preflight.maintenance;
    const backup = input.preflight.backup;
    if (!validHash(database.sha256)
        || !Number.isSafeInteger(database.bytes) || database.bytes < 1
        || !Number.isSafeInteger(database.schemaVersion) || database.schemaVersion < 1
        || (maintenance.state !== "active" && maintenance.state !== "verifying")
        || typeof maintenance.operationId !== "string" || !maintenance.operationId
        || !validHash(backup.manifestSha256)) {
      fail("recovery_point_creation_failed", "Recovery point creation failed");
    }

    sourceTemp = await dependencies.createTemporaryPath(artifactRoot, "source");
    verifyTemp = await dependencies.createTemporaryPath(artifactRoot, "verify");
    if (!contained(artifactRoot, sourceTemp) || !contained(artifactRoot, verifyTemp) || sourceTemp === verifyTemp) {
      fail("recovery_point_creation_failed", "Recovery point creation failed");
    }

    await dependencies.checkpoint(input.liveDatabasePath);
    await dependencies.backup(input.liveDatabasePath, sourceTemp);
    await dependencies.verifyIntegrity(sourceTemp);
    await dependencies.verifySchema(sourceTemp, database.schemaVersion);
    const sourceFingerprint = await dependencies.fingerprint(sourceTemp);
    if (!validHash(sourceFingerprint.sha256) || sourceFingerprint.bytes !== database.bytes) {
      fail("recovery_point_creation_failed", "Recovery point creation failed");
    }

    const encrypted = await dependencies.encrypt({
      sourcePath: sourceTemp,
      destinationPath: recoveryPointPath,
      password: input.recoveryPassword,
      createdAt: input.createdAt,
    });
    if (!validHash(encrypted.header?.plaintextSha256)
        || encrypted.header.plaintextSha256 !== sourceFingerprint.sha256
        || encrypted.header.plaintextBytes !== sourceFingerprint.bytes
        || !validHash(encrypted.artifactSha256)
        || !Number.isSafeInteger(encrypted.artifactBytes)
        || encrypted.artifactBytes < 1) {
      fail("recovery_point_creation_failed", "Recovery point creation failed");
    }
    const artifactFingerprint = await dependencies.fingerprint(recoveryPointPath);
    if (artifactFingerprint.sha256 !== encrypted.artifactSha256
        || artifactFingerprint.bytes !== encrypted.artifactBytes) {
      fail("recovery_point_creation_failed", "Recovery point creation failed");
    }

    const decrypted = await dependencies.decrypt({
      sourcePath: recoveryPointPath,
      destinationPath: verifyTemp,
      password: input.recoveryPassword,
    });
    const verifyFingerprint = await dependencies.fingerprint(verifyTemp);
    if (decrypted.plaintextSha256 !== sourceFingerprint.sha256
        || decrypted.plaintextBytes !== sourceFingerprint.bytes
        || verifyFingerprint.sha256 !== sourceFingerprint.sha256
        || verifyFingerprint.bytes !== sourceFingerprint.bytes) {
      fail("recovery_point_creation_failed", "Recovery point creation failed");
    }
    await dependencies.verifyIntegrity(verifyTemp);
    await dependencies.verifySchema(verifyTemp, database.schemaVersion);

    const recoveryPointRelativePath = relative(artifactRoot, recoveryPointPath);
    const receipt = createRecoveryReceipt({
      operationId: input.operationId,
      createdAt: input.createdAt,
      liveDatabaseRelativePath: database.relativePath,
      liveDatabaseSha256: database.sha256,
      liveDatabaseBytes: database.bytes,
      schemaVersion: database.schemaVersion,
      maintenanceOperationId: maintenance.operationId,
      backupManifestSha256: backup.manifestSha256,
      recoveryPointRelativePath,
      recoveryPointSha256: artifactFingerprint.sha256,
      recoveryPointBytes: artifactFingerprint.bytes,
      confirmation: `RESTORE PORTAL DATABASE ${input.operationId}`,
      checks: {
        checkpoint: "ok",
        sourceIntegrity: "ok",
        sourceSchema: "ok",
        encryptedRoundTrip: "ok",
        recoveryPointIntegrity: "ok",
        recoveryPointSchema: "ok",
      },
    });
    return await dependencies.writeReceipt(receiptPath, receipt);
  } catch (error) {
    if (error instanceof RecoveryError && error.code === "recovery_point_creation_failed") throw error;
    fail("recovery_point_creation_failed", "Recovery point creation failed");
  } finally {
    if (sourceTemp) await dependencies.remove(sourceTemp).catch(() => undefined);
    if (verifyTemp) await dependencies.remove(verifyTemp).catch(() => undefined);
  }
}
