import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { createRecoveryCommandHandlers } from "./recovery-command-handlers.ts";
import type { RecoveryCommandHandler, RecoveryCommandHandlers, RecoveryCommandInput } from "./recovery-cli.ts";
import { RecoveryError } from "../foundation/recovery-errors.ts";
import { recoverFailedMaintenanceOffline } from "../maintenance/recovery-maintenance.ts";
import { verifyPortalRecoveryOnline } from "../verification/recovery-online-verification.ts";
import { resolveContainedRegularFile, resolveRecoveryRoots } from "../foundation/recovery-paths.ts";
import {
  loadRecoveryReceipt,
  transitionRecoveryReceipt,
  writeRecoveryReceiptAtomic,
  type RecoveryReceipt,
} from "../foundation/recovery-receipt.ts";

function fail(code: string, message: string, exitCode = 2): never {
  throw new RecoveryError(code, exitCode, message);
}

function required(input: RecoveryCommandInput, name: string): string {
  const value = input.options[name];
  if (typeof value !== "string" || !value || value.includes("\0")) {
    fail("recovery_cli_invalid", "Recovery CLI request is invalid");
  }
  return value;
}

function nextTimestamp(previous: string): string {
  const previousMs = Date.parse(previous);
  const now = Date.now();
  if (!Number.isFinite(previousMs)) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  return new Date(Math.max(now, previousMs + 1)).toISOString();
}

function withOnlineCheck(receipt: RecoveryReceipt): RecoveryReceipt {
  return Object.freeze({
    ...receipt,
    checks: Object.freeze({ ...receipt.checks, onlineVerification: "ok" as const }),
  });
}

async function recordVerificationFailure(
  receiptPath: string,
  receipt: RecoveryReceipt,
  error: unknown,
): Promise<void> {
  if (receipt.phase !== "swapped") return;
  const code = (error as { code?: unknown } | null)?.code;
  const phase = code === "recovery_online_post_complete_failed" ? "post_complete_failed" : "failed";
  const failed = transitionRecoveryReceipt(receipt, phase, nextTimestamp(receipt.updatedAt));
  await writeRecoveryReceiptAtomic(receiptPath, failed);
}

const verifyHandler: RecoveryCommandHandler = async (input) => {
  const receiptPath = required(input, "receipt");
  const receipt = await loadRecoveryReceipt(receiptPath);
  if (receipt.phase !== "swapped") {
    fail("recovery_receipt_phase_invalid", "Recovery receipt phase is invalid", 12);
  }
  try {
    const result = await verifyPortalRecoveryOnline({
      baseUrl: required(input, "base-url"),
      serviceToken: required(input, "service-token"),
      operationId: receipt.maintenanceOperationId,
      controllerSecret: required(input, "controller-secret"),
      administratorUsername: required(input, "admin-username"),
      administratorPassword: required(input, "admin-password"),
    });
    const verified = transitionRecoveryReceipt(
      withOnlineCheck(receipt),
      "verified",
      nextTimestamp(receipt.updatedAt),
    );
    await writeRecoveryReceiptAtomic(receiptPath, verified);
    return { phase: verified.phase, operationId: result.operationId, checks: { ...verified.checks, ...result.checks } };
  } catch (error) {
    await recordVerificationFailure(receiptPath, receipt, error).catch(() => undefined);
    throw error;
  }
};

function contained(root: string, child: string): boolean {
  const offset = relative(root, child);
  return offset === "" || (!isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`));
}

async function resolveLiveDatabase(dataRoot: string, relativePath: string): Promise<string> {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]+/u).some((part) => part === ".." || !part)) {
    fail("recovery_path_invalid", "Recovery path is invalid");
  }
  const absolute = resolve(dataRoot, relativePath);
  if (!contained(dataRoot, absolute) || dirname(absolute) === absolute) {
    fail("recovery_path_invalid", "Recovery path is invalid");
  }
  const relativeParent = relative(dataRoot, dirname(absolute));
  const fileName = absolute.slice(dirname(absolute).length + 1);
  const resolved = await resolveContainedRegularFile(dataRoot, `${relativeParent}${relativeParent ? sep : ""}${fileName}`, "database");
  if (resolved !== absolute) fail("recovery_path_invalid", "Recovery path is invalid");
  return resolved;
}

const maintenanceRecoverHandler: RecoveryCommandHandler = async (input) => {
  const roots = resolveRecoveryRoots({
    dataRoot: required(input, "data-root"),
    artifactRoot: required(input, "artifact-root"),
    secretsRoot: required(input, "secrets-root"),
  });
  const receiptPath = await resolveContainedRegularFile(roots.artifactRoot, required(input, "receipt"), "receipt");
  const receipt = await loadRecoveryReceipt(receiptPath);
  const databasePath = await resolveLiveDatabase(roots.dataRoot, receipt.liveDatabaseRelativePath);
  const recoveryPointPath = await resolveContainedRegularFile(
    roots.artifactRoot,
    receipt.recoveryPointRelativePath,
    "recovery point",
  );
  return await recoverFailedMaintenanceOffline({
    receipt,
    databasePath,
    recoveryPointPath,
    confirmation: required(input, "confirmation"),
    administratorUsername: required(input, "admin-username"),
    administratorPassword: required(input, "admin-password"),
    configEncryptionKey: required(input, "config-key"),
  });
};

export function createRecoveryRuntimeCommandHandlers(): RecoveryCommandHandlers {
  return createRecoveryCommandHandlers({
    verify: verifyHandler,
    "maintenance-recover": maintenanceRecoverHandler,
  });
}
