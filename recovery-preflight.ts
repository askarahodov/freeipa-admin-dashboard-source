import { isAbsolute, relative, sep } from "node:path";

import { discoverPortalDatabase } from "./recovery-discovery.ts";
import { RecoveryError } from "./recovery-errors.ts";
import { probeRecoveryLock } from "./recovery-lock.ts";
import { resolveRecoveryRoots, type RecoveryRoots } from "./recovery-paths.ts";
import {
  loadFullRestoreSource,
  verifyBackupAdministrator,
  type FullRestoreSource,
} from "./recovery-backup-source.ts";
import {
  resolveRecoverySchemaAdapter,
  type RecoverySchemaAdapter,
} from "./recovery-schema-adapters.ts";

export type RecoveryPreflightInput = {
  dataRoot: string;
  artifactRoot: string;
  secretsRoot: string;
  lockPath: string;
  backupDocument: unknown;
  backupPassword: string;
  controllerSecret: string;
  administratorUsername: string;
  administratorPassword: string;
  configEncryptionKey: string;
  now?: number;
};

export type RecoveryPreflightDependencies = {
  resolveRoots(input: RecoveryRoots): RecoveryRoots;
  probeLock(path: string): Promise<{ available: boolean }>;
  discoverDatabase(input: { dataRoot: string }): Promise<string>;
  fingerprintFile(path: string): Promise<{ sha256: string; bytes: number }>;
  inspectCurrentDatabase(path: string): Promise<{ state: string; currentVersion: number }>;
  loadMaintenance(path: string): Promise<{
    state: string;
    operationId: string | null;
    controllerSecretHash: string | null;
  }>;
  verifyControllerSecret(secret: string, hash: string): Promise<boolean>;
  loadSource(document: unknown, password: unknown): Promise<FullRestoreSource>;
  resolveAdapter(sourceVersion: number, currentVersion: number): RecoverySchemaAdapter;
  verifyAdministrator(
    source: FullRestoreSource,
    username: string,
    password: string,
    now: number,
  ): Promise<{ userId: string; username: string }>;
  verifyEncryptedMaterial(
    source: FullRestoreSource,
    configEncryptionKey: string,
  ): Promise<{ settings: "ok"; replays: "ok"; approvals: "ok" }>;
  statDiskSpace(root: string): Promise<{ availableBytes: number }>;
};

export type RecoveryPreflightResult = Readonly<{
  checks: Readonly<{
    roots: "ok";
    lock: "ok";
    database: "ok";
    schema: "ok";
    maintenance: "ok";
    controller: "ok";
    backup: "ok";
    administrator: "ok";
    encryption: "ok";
    diskSpace: "ok";
  }>;
  database: Readonly<{
    relativePath: string;
    sha256: string;
    bytes: number;
    schemaVersion: number;
  }>;
  maintenance: Readonly<{
    state: "active" | "verifying";
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
  adapter: Readonly<{
    sourceVersion: number;
    currentVersion: number;
  }>;
  space: Readonly<{
    dataAvailableBytes: number;
    artifactAvailableBytes: number;
    dataRequiredBytes: number;
    artifactRequiredBytes: number;
  }>;
}>;

const defaultDependencies: Partial<RecoveryPreflightDependencies> = {
  resolveRoots: resolveRecoveryRoots,
  probeLock: probeRecoveryLock,
  discoverDatabase: discoverPortalDatabase,
  loadSource: loadFullRestoreSource,
  resolveAdapter: resolveRecoverySchemaAdapter,
  verifyAdministrator: verifyBackupAdministrator,
};

function fail(code: string, message: string, exitCode = 6): never {
  throw new RecoveryError(code, exitCode, message);
}

function safeInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    fail("recovery_preflight_failed", "Recovery preflight failed");
  }
  return Number(value);
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) fail("recovery_preflight_failed", "Recovery preflight failed");
  return value;
}

function checkedMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) fail("recovery_preflight_failed", "Recovery preflight failed");
  return value;
}

function validateDependencies(
  supplied: Partial<RecoveryPreflightDependencies>,
): RecoveryPreflightDependencies {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    fail("recovery_preflight_failed", "Recovery preflight failed");
  }
  const combined = { ...defaultDependencies, ...supplied } as Partial<RecoveryPreflightDependencies>;
  const names: Array<keyof RecoveryPreflightDependencies> = [
    "resolveRoots",
    "probeLock",
    "discoverDatabase",
    "fingerprintFile",
    "inspectCurrentDatabase",
    "loadMaintenance",
    "verifyControllerSecret",
    "loadSource",
    "resolveAdapter",
    "verifyAdministrator",
    "verifyEncryptedMaterial",
    "statDiskSpace",
  ];
  if (names.some((name) => typeof combined[name] !== "function")) {
    fail("recovery_preflight_failed", "Recovery preflight failed");
  }
  return combined as RecoveryPreflightDependencies;
}

function validateInput(input: RecoveryPreflightInput): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("recovery_preflight_failed", "Recovery preflight failed");
  }
  for (const value of [
    input.dataRoot,
    input.artifactRoot,
    input.secretsRoot,
    input.lockPath,
    input.backupPassword,
    input.controllerSecret,
    input.administratorUsername,
    input.administratorPassword,
    input.configEncryptionKey,
  ]) {
    if (typeof value !== "string" || !value.length || value.includes("\0")) {
      fail("recovery_preflight_failed", "Recovery preflight failed");
    }
  }
  return safeInteger(input.now ?? Date.now());
}

function safeRelativePath(root: string, path: string): string {
  const value = relative(root, path);
  if (!value
      || isAbsolute(value)
      || value === ".."
      || value.startsWith(`..${sep}`)) {
    fail("recovery_preflight_failed", "Recovery preflight failed");
  }
  return value;
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function safeKnownError(error: unknown): RecoveryError | null {
  if (error instanceof RecoveryError) return error;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^recovery_[a-z0-9_]{1,96}$/u.test(code)) {
      const messages: Record<string, string> = {
        recovery_administrator_invalid: "Recovery administrator credentials are invalid",
        recovery_backup_decryption_failed: "Encrypted portal backup validation failed",
        recovery_full_backup_required: "A complete encrypted portal backup is required",
        recovery_schema_adapter_unavailable: "Recovery schema adapter is unavailable",
        recovery_schema_newer_than_runtime: "Backup schema is newer than the recovery runtime",
      };
      return new RecoveryError(code, 6, messages[code] ?? "Recovery preflight failed");
    }
  }
  return null;
}

export async function runRecoveryPreflight(
  input: RecoveryPreflightInput,
  suppliedDependencies: Partial<RecoveryPreflightDependencies> = {},
): Promise<RecoveryPreflightResult> {
  const now = validateInput(input);
  const dependencies = validateDependencies(suppliedDependencies);
  try {
    const roots = dependencies.resolveRoots({
      dataRoot: input.dataRoot,
      artifactRoot: input.artifactRoot,
      secretsRoot: input.secretsRoot,
    });

    const lock = await dependencies.probeLock(input.lockPath);
    if (!lock || lock.available !== true) {
      fail("recovery_lock_busy", "Recovery lock is busy", 75);
    }

    const databasePath = await dependencies.discoverDatabase({ dataRoot: roots.dataRoot });
    const fingerprint = await dependencies.fingerprintFile(databasePath);
    if (!fingerprint
        || !validHash(fingerprint.sha256)
        || !Number.isSafeInteger(fingerprint.bytes)
        || fingerprint.bytes < 1) {
      fail("recovery_preflight_failed", "Recovery preflight failed");
    }
    const databaseRelativePath = safeRelativePath(roots.dataRoot, databasePath);

    const schema = await dependencies.inspectCurrentDatabase(databasePath);
    if (!schema
        || schema.state !== "ready"
        || !Number.isSafeInteger(schema.currentVersion)
        || schema.currentVersion < 1) {
      fail("recovery_schema_not_ready", "Current portal schema is not ready");
    }

    const maintenance = await dependencies.loadMaintenance(databasePath);
    if (!maintenance
        || (maintenance.state !== "active" && maintenance.state !== "verifying")
        || typeof maintenance.operationId !== "string"
        || !maintenance.operationId
        || typeof maintenance.controllerSecretHash !== "string"
        || !maintenance.controllerSecretHash) {
      fail("recovery_maintenance_required", "Active maintenance mode is required");
    }

    const controllerValid = await dependencies.verifyControllerSecret(
      input.controllerSecret,
      maintenance.controllerSecretHash,
    );
    if (controllerValid !== true) {
      fail("recovery_controller_invalid", "Maintenance controller credentials are invalid");
    }

    const source = await dependencies.loadSource(input.backupDocument, input.backupPassword);
    if (!source
        || !validHash(source.manifestSha256)
        || !Number.isSafeInteger(source.sourceSchemaVersion)
        || source.sourceSchemaVersion < 1
        || !Number.isSafeInteger(source.totalRecords)
        || source.totalRecords < 0
        || !Number.isSafeInteger(source.documentBytes)
        || source.documentBytes < 1) {
      fail("recovery_preflight_failed", "Recovery preflight failed");
    }
    const adapter = dependencies.resolveAdapter(source.sourceSchemaVersion, schema.currentVersion);
    const adaptedSource = adapter.transform(source);

    await dependencies.verifyAdministrator(
      adaptedSource,
      input.administratorUsername,
      input.administratorPassword,
      now,
    );

    try {
      const encryptedChecks = await dependencies.verifyEncryptedMaterial(
        adaptedSource,
        input.configEncryptionKey,
      );
      if (!encryptedChecks
          || encryptedChecks.settings !== "ok"
          || encryptedChecks.replays !== "ok"
          || encryptedChecks.approvals !== "ok") {
        fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
      }
    } catch (error) {
      if (error instanceof RecoveryError && error.code === "recovery_encryption_material_invalid") throw error;
      fail("recovery_encryption_material_invalid", "Encrypted portal material is invalid");
    }

    const dataSpace = await dependencies.statDiskSpace(roots.dataRoot);
    const artifactSpace = await dependencies.statDiskSpace(roots.artifactRoot);
    const dataAvailableBytes = safeInteger(dataSpace?.availableBytes);
    const artifactAvailableBytes = safeInteger(artifactSpace?.availableBytes);
    const dataRequiredBytes = checkedMultiply(fingerprint.bytes, 2);
    const artifactRequiredBytes = checkedAdd(dataRequiredBytes, adaptedSource.documentBytes);
    if (dataAvailableBytes < dataRequiredBytes || artifactAvailableBytes < artifactRequiredBytes) {
      fail("recovery_disk_space_insufficient", "Recovery disk space is insufficient");
    }

    const result: RecoveryPreflightResult = {
      checks: {
        roots: "ok",
        lock: "ok",
        database: "ok",
        schema: "ok",
        maintenance: "ok",
        controller: "ok",
        backup: "ok",
        administrator: "ok",
        encryption: "ok",
        diskSpace: "ok",
      },
      database: {
        relativePath: databaseRelativePath,
        sha256: fingerprint.sha256,
        bytes: fingerprint.bytes,
        schemaVersion: schema.currentVersion,
      },
      maintenance: {
        state: maintenance.state,
        operationId: maintenance.operationId,
      },
      backup: {
        manifestSha256: adaptedSource.manifestSha256,
        sourceSchemaVersion: adaptedSource.sourceSchemaVersion,
        domains: adaptedSource.domains.length,
        tables: Object.keys(adaptedSource.tableCounts).length,
        records: adaptedSource.totalRecords,
        documentBytes: adaptedSource.documentBytes,
      },
      adapter: {
        sourceVersion: adapter.sourceVersion,
        currentVersion: adapter.currentVersion,
      },
      space: {
        dataAvailableBytes,
        artifactAvailableBytes,
        dataRequiredBytes,
        artifactRequiredBytes,
      },
    };
    return deepFreeze(result);
  } catch (error) {
    const known = safeKnownError(error);
    if (known) throw known;
    fail("recovery_preflight_failed", "Recovery preflight failed");
  }
}
