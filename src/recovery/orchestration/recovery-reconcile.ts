import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, rename } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { RecoveryError } from "../foundation/recovery-errors.ts";
import {
  loadRecoveryReceipt,
  transitionRecoveryReceipt,
  writeRecoveryReceiptAtomic,
  type RecoveryReceipt,
  type RecoveryReceiptPhase,
} from "../foundation/recovery-receipt.ts";

export type RecoveryFilesystemFile = Readonly<{
  exists: false;
}> | Readonly<{
  exists: true;
  regular: boolean;
  sha256: string | null;
  bytes: number;
  dev: number;
}>;

export type RecoveryReconciliationAction =
  | "ready_to_swap"
  | "finish_swap"
  | "restore_original"
  | "continue_verification";

export type RecoveryFilesystemClassification = Readonly<{
  action: RecoveryReconciliationAction;
}>;

export type RecoveryReconcileInput = {
  receiptPath: string;
  livePath: string;
  candidatePath: string;
  rollbackPath: string;
  expectedOriginalSha256: string;
  expectedCandidateSha256: string;
  lockPath: string;
};

export type RecoveryReconcileDependencies = {
  loadReceipt(path: string): Promise<RecoveryReceipt>;
  writeReceipt(path: string, receipt: RecoveryReceipt): Promise<RecoveryReceipt>;
  inspectFile(path: string): Promise<RecoveryFilesystemFile>;
  fingerprintFile(path: string): Promise<{ sha256: string; bytes: number }>;
  assertLockHeld(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  fsyncDirectory(path: string): Promise<void>;
  now(): string;
};

const hashPattern = /^[a-f0-9]{64}$/u;
const allowedPhases = new Set<RecoveryReceiptPhase>(["candidate_ready", "swap_started", "swapped"]);

function fail(code: string, message: string): never {
  throw new RecoveryError(code, 10, message);
}

function validPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4096
    && isAbsolute(value)
    && !value.includes("\0");
}

function validFile(value: RecoveryFilesystemFile): boolean {
  if (!value || typeof value !== "object") return false;
  if (!value.exists) return Object.keys(value).length === 1;
  return value.regular === true
    && (value.sha256 === null || hashPattern.test(value.sha256))
    && Number.isSafeInteger(value.bytes)
    && value.bytes >= 0
    && Number.isSafeInteger(value.dev)
    && value.dev >= 0;
}

function isHash(value: RecoveryFilesystemFile, hash: string): boolean {
  return value.exists && value.regular && value.sha256 === hash;
}

function absent(value: RecoveryFilesystemFile): boolean {
  return value.exists === false;
}

export function classifyRecoveryFilesystem(input: {
  phase: RecoveryReceiptPhase;
  live: RecoveryFilesystemFile;
  candidate: RecoveryFilesystemFile;
  rollback: RecoveryFilesystemFile;
  originalSha256: string;
  candidateSha256: string;
}): RecoveryFilesystemClassification {
  if (!input
      || typeof input !== "object"
      || !allowedPhases.has(input.phase)
      || !hashPattern.test(input.originalSha256)
      || !hashPattern.test(input.candidateSha256)
      || input.originalSha256 === input.candidateSha256
      || !validFile(input.live)
      || !validFile(input.candidate)
      || !validFile(input.rollback)) {
    fail("recovery_filesystem_ambiguous", "Recovery filesystem state is ambiguous");
  }

  const ready = isHash(input.live, input.originalSha256)
    && isHash(input.candidate, input.candidateSha256)
    && absent(input.rollback);
  if ((input.phase === "candidate_ready" || input.phase === "swap_started") && ready) {
    return Object.freeze({ action: "ready_to_swap" });
  }

  const afterFirstRename = absent(input.live)
    && isHash(input.candidate, input.candidateSha256)
    && isHash(input.rollback, input.originalSha256);
  if (input.phase === "swap_started" && afterFirstRename) {
    return Object.freeze({ action: "finish_swap" });
  }

  const candidateLost = absent(input.live)
    && absent(input.candidate)
    && isHash(input.rollback, input.originalSha256);
  if (input.phase === "swap_started" && candidateLost) {
    return Object.freeze({ action: "restore_original" });
  }

  const completed = isHash(input.live, input.candidateSha256)
    && absent(input.candidate)
    && isHash(input.rollback, input.originalSha256);
  if ((input.phase === "swap_started" || input.phase === "swapped") && completed) {
    return Object.freeze({ action: "continue_verification" });
  }

  fail("recovery_filesystem_ambiguous", "Recovery filesystem state is ambiguous");
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
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("invalid size");
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

async function fsyncDirectory(path: string): Promise<void> {
  const { constants } = await import("node:fs");
  const { open } = await import("node:fs/promises");
  try {
    const handle = await open(path, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    fail("recovery_filesystem_sync_failed", "Recovery filesystem sync failed");
  }
}

function defaultDependencies(): RecoveryReconcileDependencies {
  return {
    loadReceipt: (path) => loadRecoveryReceipt(path),
    writeReceipt: (path, receipt) => writeRecoveryReceiptAtomic(path, receipt),
    inspectFile,
    fingerprintFile,
    assertLockHeld,
    rename,
    fsyncDirectory,
    now: () => new Date().toISOString(),
  };
}

function validateInput(input: RecoveryReconcileInput): void {
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
      || !hashPattern.test(input.expectedOriginalSha256)
      || !hashPattern.test(input.expectedCandidateSha256)
      || input.expectedOriginalSha256 === input.expectedCandidateSha256) {
    fail("recovery_reconcile_request_invalid", "Recovery reconciliation request is invalid");
  }
}

function withCheck(receipt: RecoveryReceipt, check: "swap" | "rollback"): RecoveryReceipt {
  return Object.freeze({ ...receipt, checks: Object.freeze({ ...receipt.checks, [check]: "ok" }) });
}

export async function reconcileRecoveryReceipt(
  input: RecoveryReconcileInput,
  suppliedDependencies: Partial<RecoveryReconcileDependencies> = {},
): Promise<Readonly<{ action: "ready_to_swap" | "continue_verification" | "restored_original"; receipt: RecoveryReceipt }>> {
  validateInput(input);
  const dependencies = { ...defaultDependencies(), ...suppliedDependencies } as RecoveryReconcileDependencies;
  try {
    const receipt = await dependencies.loadReceipt(input.receiptPath);
    if (!allowedPhases.has(receipt.phase)
        || receipt.liveDatabaseSha256 !== input.expectedOriginalSha256) {
      fail("recovery_receipt_phase_invalid", "Recovery receipt phase is invalid");
    }
    await dependencies.assertLockHeld(input.lockPath);
    const [live, candidate, rollback] = await Promise.all([
      dependencies.inspectFile(input.livePath),
      dependencies.inspectFile(input.candidatePath),
      dependencies.inspectFile(input.rollbackPath),
    ]);
    const classification = classifyRecoveryFilesystem({
      phase: receipt.phase,
      live,
      candidate,
      rollback,
      originalSha256: input.expectedOriginalSha256,
      candidateSha256: input.expectedCandidateSha256,
    });

    if (classification.action === "ready_to_swap") {
      return Object.freeze({ action: "ready_to_swap", receipt });
    }

    if (classification.action === "finish_swap") {
      await dependencies.rename(input.candidatePath, input.livePath);
      await dependencies.fsyncDirectory(dirname(input.livePath));
      const [newLive, original] = await Promise.all([
        dependencies.fingerprintFile(input.livePath),
        dependencies.fingerprintFile(input.rollbackPath),
      ]);
      if (newLive.sha256 !== input.expectedCandidateSha256
          || original.sha256 !== input.expectedOriginalSha256) {
        fail("recovery_filesystem_ambiguous", "Recovery filesystem state is ambiguous");
      }
      const swapped = transitionRecoveryReceipt(
        withCheck(receipt, "swap"),
        "swapped",
        dependencies.now(),
      );
      const written = await dependencies.writeReceipt(input.receiptPath, swapped);
      return Object.freeze({ action: "continue_verification", receipt: written });
    }

    if (classification.action === "restore_original") {
      await dependencies.rename(input.rollbackPath, input.livePath);
      await dependencies.fsyncDirectory(dirname(input.livePath));
      const restored = await dependencies.fingerprintFile(input.livePath);
      if (restored.sha256 !== input.expectedOriginalSha256) {
        fail("recovery_filesystem_ambiguous", "Recovery filesystem state is ambiguous");
      }
      const failed = transitionRecoveryReceipt(receipt, "failed", dependencies.now());
      const written = await dependencies.writeReceipt(input.receiptPath, failed);
      return Object.freeze({ action: "restored_original", receipt: written });
    }

    const [newLive, original] = await Promise.all([
      dependencies.fingerprintFile(input.livePath),
      dependencies.fingerprintFile(input.rollbackPath),
    ]);
    if (newLive.sha256 !== input.expectedCandidateSha256
        || original.sha256 !== input.expectedOriginalSha256) {
      fail("recovery_filesystem_ambiguous", "Recovery filesystem state is ambiguous");
    }
    if (receipt.phase === "swapped") {
      return Object.freeze({ action: "continue_verification", receipt });
    }
    const swapped = transitionRecoveryReceipt(
      withCheck(receipt, "swap"),
      "swapped",
      dependencies.now(),
    );
    const written = await dependencies.writeReceipt(input.receiptPath, swapped);
    return Object.freeze({ action: "continue_verification", receipt: written });
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_reconcile_failed", "Recovery reconciliation failed");
  }
}
