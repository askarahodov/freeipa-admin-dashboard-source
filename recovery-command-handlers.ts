import { randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { MAX_ENCRYPTED_BACKUP_DOCUMENT_BYTES } from "./src/backup/crypto/backup-encryption.ts";
import { loadFullRestoreSource } from "./src/recovery/foundation/recovery-backup-source.ts";
import { buildRecoveryCandidate } from "./recovery-candidate.ts";
import type {
  RecoveryCliCommand,
  RecoveryCommandHandler,
  RecoveryCommandHandlers,
  RecoveryCommandInput,
} from "./recovery-cli.ts";
import { RecoveryError } from "./src/recovery/foundation/recovery-errors.ts";
import {
  fingerprintRecoveryFile,
  inspectRecoveryDatabase,
  loadRecoveryMaintenance,
  statRecoveryDiskSpace,
  verifyRecoveryEncryptedMaterial,
} from "./src/recovery/adapters/recovery-local-adapters.ts";
import { probeRecoveryLock } from "./src/recovery/foundation/recovery-lock.ts";
import { verifyMaintenanceControllerSecret } from "./maintenance-mode.ts";
import { resolveRecoveryRoots, type RecoveryRoots } from "./src/recovery/foundation/recovery-paths.ts";
import { runRecoveryPreflight } from "./recovery-preflight.ts";
import { createRecoveryPoint } from "./recovery-point.ts";
import { reconcileRecoveryReceipt } from "./recovery-reconcile.ts";
import {
  bindRecoveryCandidateReceipt,
  loadRecoveryReceipt,
  writeRecoveryReceiptAtomic,
  type RecoveryReceipt,
} from "./src/recovery/foundation/recovery-receipt.ts";
import { resolveRecoverySchemaAdapter } from "./src/recovery/adapters/recovery-schema-adapters.ts";
import { rollbackRecoverySwap, swapRecoveryCandidate } from "./recovery-swap.ts";

export type RecoveryCommandHandlerOverrides = Partial<Record<RecoveryCliCommand, RecoveryCommandHandler>>;

const hashPattern = /^[a-f0-9]{64}$/u;
const MAX_JSON_FILE_BYTES = MAX_ENCRYPTED_BACKUP_DOCUMENT_BYTES;

function fail(code: string, message: string, exitCode = 2): never {
  throw new RecoveryError(code, exitCode, message);
}

function unavailable(command: RecoveryCliCommand): RecoveryCommandHandler {
  return async () => {
    throw new RecoveryError("recovery_command_unavailable", 2, `Recovery command ${command} is unavailable`);
  };
}

function contains(root: string, child: string): boolean {
  const offset = relative(root, child);
  return offset === "" || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}

function safeRelative(root: string, child: string): string {
  const value = relative(root, child);
  if (!value || isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)) {
    fail("recovery_path_invalid", "Recovery path is invalid");
  }
  return value.split(sep).join("/");
}

async function resolveContainedPath(
  root: string,
  input: string,
  mode: "existing-file" | "existing-or-new-file" | "new-file",
): Promise<string> {
  if (typeof input !== "string" || !input || input.includes("\0") || input.length > 4096) {
    fail("recovery_path_invalid", "Recovery path is invalid");
  }
  const candidate = resolve(isAbsolute(input) ? input : resolve(root, input));
  if (!contains(root, candidate) || candidate === root) fail("recovery_path_invalid", "Recovery path is invalid");
  const parent = await realpath(resolve(candidate, ".." as never)).catch(async () => await realpath(candidate.slice(0, candidate.lastIndexOf("/"))).catch(() => ""));
  if (!parent || !contains(root, parent)) fail("recovery_path_invalid", "Recovery path is invalid");
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail("recovery_path_invalid", "Recovery path is invalid");
    const canonical = await realpath(candidate);
    if (canonical !== candidate || !contains(root, canonical)) fail("recovery_path_invalid", "Recovery path is invalid");
    if (mode === "new-file") fail("recovery_path_exists", "Recovery output path already exists");
    return candidate;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || mode === "existing-file") {
      fail("recovery_path_invalid", "Recovery path is invalid");
    }
    return candidate;
  }
}

async function readBoundedJson(path: string): Promise<unknown> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_JSON_FILE_BYTES) {
      fail("recovery_backup_document_invalid", "Recovery backup document is invalid");
    }
    const contents = await readFile(path, "utf8");
    if (new TextEncoder().encode(contents).byteLength !== metadata.size) {
      fail("recovery_backup_document_invalid", "Recovery backup document is invalid");
    }
    return JSON.parse(contents) as unknown;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_backup_document_invalid", "Recovery backup document is invalid");
  }
}

function exactSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  try {
    return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}

function timestampAfter(value: string): string {
  const previous = Date.parse(value);
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : Date.now())).toISOString();
}

function requireOption(input: RecoveryCommandInput, name: string): string {
  const value = input.options[name];
  if (typeof value !== "string" || !value.length) fail("recovery_cli_invalid", "Recovery CLI request is invalid");
  return value;
}

async function prepareRoots(input: RecoveryCommandInput): Promise<RecoveryRoots> {
  return resolveRecoveryRoots({
    dataRoot: requireOption(input, "data-root"),
    artifactRoot: requireOption(input, "artifact-root"),
    secretsRoot: requireOption(input, "secrets-root"),
  });
}

async function runFreshPreflight(
  input: RecoveryCommandInput,
  lockAlreadyHeld: boolean,
): Promise<{
  roots: RecoveryRoots;
  backupDocument: unknown;
  result: Awaited<ReturnType<typeof runRecoveryPreflight>>;
}> {
  const roots = await prepareRoots(input);
  const backupPath = await resolveContainedPath(roots.artifactRoot, requireOption(input, "backup"), "existing-file");
  const backupDocument = await readBoundedJson(backupPath);
  const result = await runRecoveryPreflight({
    dataRoot: roots.dataRoot,
    artifactRoot: roots.artifactRoot,
    secretsRoot: roots.secretsRoot,
    lockPath: requireOption(input, "lock-path"),
    backupDocument,
    backupPassword: requireOption(input, "backup-password"),
    controllerSecret: requireOption(input, "controller-secret"),
    administratorUsername: requireOption(input, "admin-username"),
    administratorPassword: requireOption(input, "admin-password"),
    configEncryptionKey: requireOption(input, "config-key"),
  }, {
    probeLock: lockAlreadyHeld ? async () => ({ available: true }) : probeRecoveryLock,
    fingerprintFile: fingerprintRecoveryFile,
    inspectCurrentDatabase: inspectRecoveryDatabase,
    loadMaintenance: loadRecoveryMaintenance,
    verifyControllerSecret: async (secret, expectedHash) => verifyMaintenanceControllerSecret(expectedHash, secret),
    verifyEncryptedMaterial: verifyRecoveryEncryptedMaterial,
    statDiskSpace: statRecoveryDiskSpace,
  });
  return { roots, backupDocument, result };
}

function validateReceiptBindings(receipt: RecoveryReceipt, preflight: Awaited<ReturnType<typeof runRecoveryPreflight>>): void {
  if (receipt.liveDatabaseSha256 !== preflight.database.sha256
      || receipt.liveDatabaseBytes !== preflight.database.bytes
      || receipt.liveDatabaseRelativePath !== preflight.database.relativePath
      || receipt.schemaVersion !== preflight.database.schemaVersion
      || receipt.maintenanceOperationId !== preflight.maintenance.operationId
      || receipt.backupManifestSha256 !== preflight.backup.manifestSha256) {
    fail("recovery_receipt_binding_invalid", "Recovery receipt binding is invalid", 9);
  }
}

const preflightHandler: RecoveryCommandHandler = async (input) => (await runFreshPreflight(input, false)).result;

const backupCurrentHandler: RecoveryCommandHandler = async (input) => {
  const value = await runFreshPreflight(input, true);
  const operationId = `recovery_${randomUUID()}`;
  const recoveryPointPath = await resolveContainedPath(value.roots.artifactRoot, requireOption(input, "recovery-point"), "new-file");
  const receiptPath = await resolveContainedPath(value.roots.artifactRoot, requireOption(input, "receipt"), "new-file");
  const receipt = await createRecoveryPoint({
    liveDatabasePath: resolve(value.roots.dataRoot, value.result.database.relativePath),
    artifactRoot: value.roots.artifactRoot,
    recoveryPointPath,
    receiptPath,
    recoveryPassword: requireOption(input, "recovery-password"),
    operationId,
    createdAt: new Date().toISOString(),
    preflight: value.result,
  });
  return {
    operationId: receipt.operationId,
    phase: receipt.phase,
    confirmation: receipt.confirmation,
    receipt: safeRelative(value.roots.artifactRoot, receiptPath),
    recoveryPoint: receipt.recoveryPointRelativePath,
    checks: receipt.checks,
  };
};

async function sourceForRestore(backupDocument: unknown, input: RecoveryCommandInput, currentSchemaVersion: number) {
  const source = await loadFullRestoreSource(backupDocument, requireOption(input, "backup-password"));
  return resolveRecoverySchemaAdapter(source.sourceSchemaVersion, currentSchemaVersion).transform(source);
}

const restoreHandler: RecoveryCommandHandler = async (input) => {
  const value = await runFreshPreflight(input, true);
  const receiptPath = await resolveContainedPath(value.roots.artifactRoot, requireOption(input, "receipt"), "existing-file");
  let receipt = await loadRecoveryReceipt(receiptPath);
  validateReceiptBindings(receipt, value.result);
  if (!exactSecret(requireOption(input, "confirmation"), receipt.confirmation)) {
    fail("recovery_confirmation_invalid", "Recovery confirmation is invalid", 9);
  }
  const livePath = resolve(value.roots.dataRoot, receipt.liveDatabaseRelativePath);
  const candidatePath = await resolveContainedPath(value.roots.dataRoot, requireOption(input, "candidate"), receipt.phase === "recovery_point_ready" ? "new-file" : "existing-or-new-file");
  const rollbackPath = await resolveContainedPath(value.roots.dataRoot, requireOption(input, "rollback"), "existing-or-new-file");

  if (receipt.phase === "recovery_point_ready") {
    const source = await sourceForRestore(value.backupDocument, input, value.result.database.schemaVersion);
    const candidate = await buildRecoveryCandidate({
      livePath,
      candidatePath,
      expectedLiveSha256: receipt.liveDatabaseSha256,
      source,
      operationId: receipt.operationId,
      administratorUsername: requireOption(input, "admin-username"),
      administratorPassword: requireOption(input, "admin-password"),
      configEncryptionKey: requireOption(input, "config-key"),
      schemaVersion: value.result.database.schemaVersion,
    }, { verifyEncryptedMaterial: verifyRecoveryEncryptedMaterial });
    receipt = bindRecoveryCandidateReceipt(receipt, {
      candidateRelativePath: safeRelative(value.roots.dataRoot, candidatePath),
      candidateSha256: candidate.candidate.sha256,
      candidateBytes: candidate.candidate.bytes,
      rollbackRelativePath: safeRelative(value.roots.dataRoot, rollbackPath),
      checks: {
        candidateIntegrity: candidate.checks.integrity,
        candidateSchema: candidate.checks.schema,
        candidateAdministrator: candidate.checks.administrator,
        candidateEncryption: candidate.checks.encryption,
        candidateAudit: candidate.checks.audit,
      },
    }, timestampAfter(receipt.updatedAt));
    receipt = await writeRecoveryReceiptAtomic(receiptPath, receipt);
  }

  if (!receipt.candidateSha256
      || !receipt.candidateRelativePath
      || !receipt.rollbackRelativePath
      || receipt.candidateRelativePath !== safeRelative(value.roots.dataRoot, candidatePath)
      || receipt.rollbackRelativePath !== safeRelative(value.roots.dataRoot, rollbackPath)) {
    fail("recovery_receipt_binding_invalid", "Recovery receipt binding is invalid", 9);
  }
  if (receipt.phase === "candidate_ready") {
    receipt = await swapRecoveryCandidate({
      receiptPath,
      livePath,
      candidatePath,
      rollbackPath,
      expectedLiveSha256: receipt.liveDatabaseSha256,
      expectedCandidateSha256: receipt.candidateSha256,
      lockPath: requireOption(input, "lock-path"),
    });
    return { phase: receipt.phase, checks: receipt.checks };
  }
  if (receipt.phase === "swap_started" || receipt.phase === "swapped") {
    const reconciled = await reconcileRecoveryReceipt({
      receiptPath,
      livePath,
      candidatePath,
      rollbackPath,
      expectedOriginalSha256: receipt.liveDatabaseSha256,
      expectedCandidateSha256: receipt.candidateSha256,
      lockPath: requireOption(input, "lock-path"),
    });
    return { phase: reconciled.receipt.phase, action: reconciled.action, checks: reconciled.receipt.checks };
  }
  fail("recovery_receipt_phase_invalid", "Recovery receipt phase is invalid", 9);
};

const rollbackHandler: RecoveryCommandHandler = async (input) => {
  const roots = await prepareRoots(input);
  const receiptPath = await resolveContainedPath(roots.artifactRoot, requireOption(input, "receipt"), "existing-file");
  const receipt = await loadRecoveryReceipt(receiptPath);
  if (!receipt.candidateSha256 || !hashPattern.test(receipt.candidateSha256)) {
    fail("recovery_receipt_binding_invalid", "Recovery receipt binding is invalid", 9);
  }
  const livePath = await resolveContainedPath(roots.dataRoot, requireOption(input, "live"), "existing-file");
  const rollbackPath = await resolveContainedPath(roots.dataRoot, requireOption(input, "rollback"), "existing-or-new-file");
  const failedPath = await resolveContainedPath(roots.dataRoot, requireOption(input, "failed"), "new-file");
  const recoveryTempPath = await resolveContainedPath(roots.dataRoot, requireOption(input, "recovery-temp"), "new-file");
  const recoveryPointPath = await resolveContainedPath(roots.artifactRoot, requireOption(input, "recovery-point"), "existing-file");
  const current = await fingerprintRecoveryFile(livePath);
  const result = await rollbackRecoverySwap({
    receiptPath,
    livePath,
    rollbackPath,
    failedPath,
    recoveryPointPath,
    recoveryPassword: requireOption(input, "recovery-password"),
    recoveryTempPath,
    expectedCurrentSha256: current.sha256,
    expectedOriginalSha256: receipt.liveDatabaseSha256,
    lockPath: requireOption(input, "lock-path"),
  });
  return { phase: result.phase, checks: result.checks };
};

const defaultStatus: RecoveryCommandHandler = async (input) => ({ receipt: await loadRecoveryReceipt(requireOption(input, "receipt")) });

export function createRecoveryCommandHandlers(overrides: RecoveryCommandHandlerOverrides = {}): RecoveryCommandHandlers {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new RecoveryError("recovery_cli_dependency_invalid", 2, "Recovery CLI dependency is invalid");
  }
  return Object.freeze({
    preflight: overrides.preflight ?? preflightHandler,
    "backup-current": overrides["backup-current"] ?? backupCurrentHandler,
    restore: overrides.restore ?? restoreHandler,
    status: overrides.status ?? defaultStatus,
    verify: overrides.verify ?? unavailable("verify"),
    rollback: overrides.rollback ?? rollbackHandler,
    "maintenance-recover": overrides["maintenance-recover"] ?? unavailable("maintenance-recover"),
  });
}
