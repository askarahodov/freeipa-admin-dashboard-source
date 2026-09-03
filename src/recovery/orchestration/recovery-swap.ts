import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { RecoveryError } from "../foundation/recovery-errors.ts";
import { decryptRecoveryPointFile } from "../artifacts/recovery-point.ts";
import {
  loadRecoveryReceipt,
  transitionRecoveryReceipt,
  writeRecoveryReceiptAtomic,
  type RecoveryReceipt,
} from "../foundation/recovery-receipt.ts";
import type { RecoveryFilesystemFile } from "./recovery-reconcile.ts";
import { verifySqliteIntegrity } from "../foundation/recovery-sqlite.ts";

export type RecoverySwapInput = {
  receiptPath: string;
  livePath: string;
  candidatePath: string;
  rollbackPath: string;
  expectedLiveSha256: string;
  expectedCandidateSha256: string;
  lockPath: string;
};

export type RecoveryRollbackInput = {
  receiptPath: string;
  livePath: string;
  rollbackPath: string;
  failedPath: string;
  recoveryPointPath: string;
  recoveryPassword: string;
  recoveryTempPath: string;
  expectedCurrentSha256: string;
  expectedOriginalSha256: string;
  lockPath: string;
};

export type RecoverySwapDependencies = {
  loadReceipt(path: string): Promise<RecoveryReceipt>;
  writeReceipt(path: string, receipt: RecoveryReceipt): Promise<RecoveryReceipt>;
  inspectFile(path: string): Promise<RecoveryFilesystemFile>;
  fingerprintFile(path: string): Promise<{ sha256: string; bytes: number }>;
  assertLockHeld(path: string): Promise<void>;
  fsyncFile(path: string): Promise<void>;
  fsyncDirectory(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
  materializeRecoveryPoint(input: {
    sourcePath: string;
    destinationPath: string;
    password: string;
  }): Promise<{ sha256: string; bytes: number }>;
  checkpoint(name: string): Promise<void>;
  now(): string;
};

const hashPattern = /^[a-f0-9]{64}$/u;
const rollbackPhases = new Set(["swap_started", "swapped", "failed", "post_complete_failed"]);

function fail(code: string, message: string, exitCode = 11): never {
  throw new RecoveryError(code, exitCode, message);
}

function validPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4096
    && isAbsolute(value)
    && !value.includes("\0");
}

function monotonicTimestamp(previous: string, proposed: string): string {
  const previousMs = Date.parse(previous);
  const proposedMs = Date.parse(proposed);
  if (!Number.isFinite(previousMs) || !Number.isFinite(proposedMs)) {
    fail("recovery_timestamp_invalid", "Recovery timestamp is invalid");
  }
  return new Date(Math.max(proposedMs, previousMs + 1)).toISOString();
}

function withCheck(receipt: RecoveryReceipt, check: "swap" | "rollback"): RecoveryReceipt {
  return Object.freeze({ ...receipt, checks: Object.freeze({ ...receipt.checks, [check]: "ok" }) });
}

async function fingerprintFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      hash.update(buffer);
    }
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("invalid file");
    return { sha256: hash.digest("hex"), bytes };
  } catch {
    fail("recovery_filesystem_inspection_failed", "Recovery filesystem inspection failed");
  }
}

async function inspectFile(path: string): Promise<RecoveryFilesystemFile> {
  try {
    const value = await lstat(path);
    if (value.isSymbolicLink() || !value.isFile()) {
      fail("recovery_filesystem_ambiguous", "Recovery filesystem state is ambiguous");
    }
    const fingerprint = await fingerprintFile(path);
    return Object.freeze({
      exists: true,
      regular: true,
      sha256: fingerprint.sha256,
      bytes: fingerprint.bytes,
      dev: value.dev,
    });
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze({ exists: false });
    fail("recovery_filesystem_inspection_failed", "Recovery filesystem inspection failed");
  }
}

async function assertLockHeld(path: string): Promise<void> {
  try {
    const value = await lstat(path);
    if (value.isSymbolicLink() || !value.isFile()) throw new Error("invalid lock");
  } catch {
    fail("recovery_lock_required", "Recovery lock is required");
  }
}

async function syncPath(path: string, directory: boolean): Promise<void> {
  try {
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(path, constants.O_RDONLY | (directory ? 0 : noFollow));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    fail("recovery_filesystem_sync_failed", "Recovery filesystem sync failed");
  }
}

async function materializeRecoveryPoint(input: {
  sourcePath: string;
  destinationPath: string;
  password: string;
}): Promise<{ sha256: string; bytes: number }> {
  const decrypted = await decryptRecoveryPointFile(input);
  await verifySqliteIntegrity(input.destinationPath);
  const fingerprint = await fingerprintFile(input.destinationPath);
  if (fingerprint.sha256 !== decrypted.plaintextSha256
      || fingerprint.bytes !== decrypted.plaintextBytes) {
    await rm(input.destinationPath, { force: true }).catch(() => undefined);
    fail("recovery_point_decryption_failed", "Recovery point decryption failed");
  }
  return fingerprint;
}

function defaultDependencies(): RecoverySwapDependencies {
  return {
    loadReceipt: (path) => loadRecoveryReceipt(path),
    writeReceipt: (path, receipt) => writeRecoveryReceiptAtomic(path, receipt),
    inspectFile,
    fingerprintFile,
    assertLockHeld,
    fsyncFile: (path) => syncPath(path, false),
    fsyncDirectory: (path) => syncPath(path, true),
    rename,
    remove: (path) => rm(path, { force: true }),
    materializeRecoveryPoint,
    checkpoint: async () => undefined,
    now: () => new Date().toISOString(),
  };
}

function completeDependencies(
  supplied: Partial<RecoverySwapDependencies>,
): RecoverySwapDependencies {
  const dependencies = { ...defaultDependencies(), ...supplied } as RecoverySwapDependencies;
  const names: Array<keyof RecoverySwapDependencies> = [
    "loadReceipt", "writeReceipt", "inspectFile", "fingerprintFile", "assertLockHeld",
    "fsyncFile", "fsyncDirectory", "rename", "remove", "materializeRecoveryPoint",
    "checkpoint", "now",
  ];
  if (names.some((name) => typeof dependencies[name] !== "function")) {
    fail("recovery_swap_dependency_missing", "Recovery swap dependency is unavailable", 2);
  }
  return dependencies;
}

function validateSwapInput(input: RecoverySwapInput): void {
  if (!input
      || typeof input !== "object"
      || !validPath(input.receiptPath)
      || !validPath(input.livePath)
      || !validPath(input.candidatePath)
      || !validPath(input.rollbackPath)
      || !validPath(input.lockPath)
      || new Set([input.livePath, input.candidatePath, input.rollbackPath]).size !== 3
      || dirname(input.livePath) !== dirname(input.candidatePath)
      || dirname(input.livePath) !== dirname(input.rollbackPath)
      || !hashPattern.test(input.expectedLiveSha256)
      || !hashPattern.test(input.expectedCandidateSha256)
      || input.expectedLiveSha256 === input.expectedCandidateSha256) {
    fail("recovery_swap_request_invalid", "Recovery swap request is invalid", 2);
  }
}

function validateRollbackInput(input: RecoveryRollbackInput): void {
  if (!input
      || typeof input !== "object"
      || !validPath(input.receiptPath)
      || !validPath(input.livePath)
      || !validPath(input.rollbackPath)
      || !validPath(input.failedPath)
      || !validPath(input.recoveryPointPath)
      || !validPath(input.recoveryTempPath)
      || !validPath(input.lockPath)
      || new Set([input.livePath, input.rollbackPath, input.failedPath, input.recoveryTempPath]).size !== 4
      || [input.rollbackPath, input.failedPath, input.recoveryTempPath].some((path) => dirname(path) !== dirname(input.livePath))
      || typeof input.recoveryPassword !== "string"
      || input.recoveryPassword.length < 1
      || input.recoveryPassword.length > 1024
      || !hashPattern.test(input.expectedCurrentSha256)
      || !hashPattern.test(input.expectedOriginalSha256)
      || input.expectedCurrentSha256 === input.expectedOriginalSha256) {
    fail("recovery_rollback_request_invalid", "Recovery rollback request is invalid", 2);
  }
}

function requireRegular(
  value: RecoveryFilesystemFile,
  code: string,
): asserts value is Extract<RecoveryFilesystemFile, { exists: true }> {
  if (!value.exists || !value.regular || !value.sha256 || !hashPattern.test(value.sha256) || value.bytes < 1) {
    fail(code, "Recovery filesystem state is invalid");
  }
}

export async function swapRecoveryCandidate(
  input: RecoverySwapInput,
  suppliedDependencies: Partial<RecoverySwapDependencies> = {},
): Promise<RecoveryReceipt> {
  validateSwapInput(input);
  const dependencies = completeDependencies(suppliedDependencies);
  let receipt: RecoveryReceipt | null = null;
  let swapStarted = false;
  try {
    receipt = await dependencies.loadReceipt(input.receiptPath);
    if (receipt.phase !== "candidate_ready"
        || receipt.liveDatabaseSha256 !== input.expectedLiveSha256) {
      fail("recovery_receipt_phase_invalid", "Recovery receipt phase is invalid");
    }
    await dependencies.assertLockHeld(input.lockPath);
    const [live, candidate, rollback] = await Promise.all([
      dependencies.inspectFile(input.livePath),
      dependencies.inspectFile(input.candidatePath),
      dependencies.inspectFile(input.rollbackPath),
    ]);
    requireRegular(live, "recovery_live_database_invalid");
    requireRegular(candidate, "recovery_candidate_invalid");
    if (rollback.exists) fail("recovery_rollback_exists", "Recovery rollback path already exists");
    if (live.dev !== candidate.dev
        || live.sha256 !== input.expectedLiveSha256
        || candidate.sha256 !== input.expectedCandidateSha256) {
      fail("recovery_swap_binding_invalid", "Recovery swap binding is invalid");
    }
    await dependencies.fsyncFile(input.candidatePath);
    const started = transitionRecoveryReceipt(
      receipt,
      "swap_started",
      monotonicTimestamp(receipt.updatedAt, dependencies.now()),
    );
    receipt = await dependencies.writeReceipt(input.receiptPath, started);
    swapStarted = true;
    await dependencies.checkpoint("before_live_rename");
    await dependencies.rename(input.livePath, input.rollbackPath);
    await dependencies.checkpoint("after_live_rename");
    await dependencies.rename(input.candidatePath, input.livePath);
    await dependencies.checkpoint("after_candidate_rename");
    await dependencies.fsyncDirectory(dirname(input.livePath));
    await dependencies.checkpoint("after_directory_fsync");
    const [newLive, original] = await Promise.all([
      dependencies.fingerprintFile(input.livePath),
      dependencies.fingerprintFile(input.rollbackPath),
    ]);
    if (newLive.sha256 !== input.expectedCandidateSha256
        || original.sha256 !== input.expectedLiveSha256) {
      fail("recovery_swap_verification_failed", "Recovery swap verification failed");
    }
    const swapped = transitionRecoveryReceipt(
      withCheck(receipt, "swap"),
      "swapped",
      monotonicTimestamp(receipt.updatedAt, dependencies.now()),
    );
    return await dependencies.writeReceipt(input.receiptPath, swapped);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    if (swapStarted) fail("recovery_swap_incomplete", "Recovery swap is incomplete");
    fail("recovery_swap_failed", "Recovery swap failed");
  }
}

export async function rollbackRecoverySwap(
  input: RecoveryRollbackInput,
  suppliedDependencies: Partial<RecoverySwapDependencies> = {},
): Promise<RecoveryReceipt> {
  validateRollbackInput(input);
  const dependencies = completeDependencies(suppliedDependencies);
  let sourcePath = input.rollbackPath;
  let materialized = false;
  let rollbackStarted = false;
  let firstRenameCompleted = false;
  try {
    let receipt = await dependencies.loadReceipt(input.receiptPath);
    if (!rollbackPhases.has(receipt.phase)
        || receipt.liveDatabaseSha256 !== input.expectedOriginalSha256) {
      fail("recovery_receipt_phase_invalid", "Recovery receipt phase is invalid");
    }
    await dependencies.assertLockHeld(input.lockPath);
    const [live, retained, failed, recoveryTemp] = await Promise.all([
      dependencies.inspectFile(input.livePath),
      dependencies.inspectFile(input.rollbackPath),
      dependencies.inspectFile(input.failedPath),
      dependencies.inspectFile(input.recoveryTempPath),
    ]);
    requireRegular(live, "recovery_live_database_invalid");
    if (live.sha256 !== input.expectedCurrentSha256) {
      fail("recovery_rollback_binding_invalid", "Recovery rollback binding is invalid");
    }
    if (failed.exists || recoveryTemp.exists) {
      fail("recovery_rollback_destination_exists", "Recovery rollback destination already exists");
    }
    if (retained.exists) {
      requireRegular(retained, "recovery_rollback_source_invalid");
      if (retained.sha256 !== input.expectedOriginalSha256 || retained.dev !== live.dev) {
        fail("recovery_rollback_binding_invalid", "Recovery rollback binding is invalid");
      }
    } else {
      sourcePath = input.recoveryTempPath;
      const materializedResult = await dependencies.materializeRecoveryPoint({
        sourcePath: input.recoveryPointPath,
        destinationPath: input.recoveryTempPath,
        password: input.recoveryPassword,
      });
      materialized = true;
      if (materializedResult.sha256 !== input.expectedOriginalSha256 || materializedResult.bytes < 1) {
        fail("recovery_rollback_source_invalid", "Recovery rollback source is invalid");
      }
      const source = await dependencies.inspectFile(sourcePath);
      requireRegular(source, "recovery_rollback_source_invalid");
      if (source.sha256 !== input.expectedOriginalSha256 || source.dev !== live.dev) {
        fail("recovery_rollback_binding_invalid", "Recovery rollback binding is invalid");
      }
    }
    await dependencies.fsyncFile(sourcePath);
    const started = transitionRecoveryReceipt(
      receipt,
      "rollback_started",
      monotonicTimestamp(receipt.updatedAt, dependencies.now()),
    );
    receipt = await dependencies.writeReceipt(input.receiptPath, started);
    rollbackStarted = true;
    await dependencies.checkpoint("before_failed_rename");
    await dependencies.rename(input.livePath, input.failedPath);
    firstRenameCompleted = true;
    await dependencies.checkpoint("after_failed_rename");
    await dependencies.rename(sourcePath, input.livePath);
    materialized = false;
    await dependencies.checkpoint("after_restore_rename");
    await dependencies.fsyncDirectory(dirname(input.livePath));
    await dependencies.checkpoint("after_rollback_directory_fsync");
    const [restored, failedDatabase] = await Promise.all([
      dependencies.fingerprintFile(input.livePath),
      dependencies.fingerprintFile(input.failedPath),
    ]);
    if (restored.sha256 !== input.expectedOriginalSha256
        || failedDatabase.sha256 !== input.expectedCurrentSha256) {
      fail("recovery_rollback_verification_failed", "Recovery rollback verification failed");
    }
    const rolledBack = transitionRecoveryReceipt(
      withCheck(receipt, "rollback"),
      "rolled_back",
      monotonicTimestamp(receipt.updatedAt, dependencies.now()),
    );
    return await dependencies.writeReceipt(input.receiptPath, rolledBack);
  } catch (error) {
    if (firstRenameCompleted) {
      const current = await dependencies.inspectFile(input.livePath).catch(() => ({ exists: false } as const));
      const failed = await dependencies.inspectFile(input.failedPath).catch(() => ({ exists: false } as const));
      if (!current.exists && failed.exists) {
        await dependencies.rename(input.failedPath, input.livePath).catch(() => undefined);
        await dependencies.fsyncDirectory(dirname(input.livePath)).catch(() => undefined);
      }
    }
    if (materialized) await dependencies.remove(input.recoveryTempPath).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    if (rollbackStarted) fail("recovery_rollback_incomplete", "Recovery rollback is incomplete");
    fail("recovery_rollback_failed", "Recovery rollback failed");
  }
}
