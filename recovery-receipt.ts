import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import { RecoveryError } from "./recovery-errors.ts";

export const RECOVERY_RECEIPT_PHASES = [
  "recovery_point_ready",
  "candidate_ready",
  "swap_started",
  "swapped",
  "verified",
  "rollback_started",
  "rolled_back",
  "failed",
  "post_complete_failed",
] as const;

export type RecoveryReceiptPhase = typeof RECOVERY_RECEIPT_PHASES[number];

export type RecoveryReceipt = Readonly<{
  format: "portal-offline-recovery-receipt";
  version: 1;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  phase: RecoveryReceiptPhase;
  liveDatabaseRelativePath: string;
  liveDatabaseSha256: string;
  liveDatabaseBytes: number;
  schemaVersion: number;
  maintenanceOperationId: string;
  backupManifestSha256: string;
  recoveryPointRelativePath: string;
  recoveryPointSha256: string;
  recoveryPointBytes: number;
  candidateRelativePath: string | null;
  candidateSha256: string | null;
  candidateBytes: number | null;
  rollbackRelativePath: string | null;
  confirmation: string;
  checks: Readonly<Record<string, "ok">>;
}>;

export type RecoveryReceiptInput = Omit<
  RecoveryReceipt,
  | "format"
  | "version"
  | "updatedAt"
  | "phase"
  | "candidateRelativePath"
  | "candidateSha256"
  | "candidateBytes"
  | "rollbackRelativePath"
>;

export type RecoveryCandidateReceiptBinding = Readonly<{
  candidateRelativePath: string;
  candidateSha256: string;
  candidateBytes: number;
  rollbackRelativePath: string;
  checks: Readonly<{
    candidateIntegrity: "ok";
    candidateSchema: "ok";
    candidateAdministrator: "ok";
    candidateEncryption: "ok";
    candidateAudit: "ok";
  }>;
}>;

export type RecoveryReceiptWriteDependencies = {
  rename?: typeof rename;
};

const receiptKeys = [
  "format",
  "version",
  "operationId",
  "createdAt",
  "updatedAt",
  "phase",
  "liveDatabaseRelativePath",
  "liveDatabaseSha256",
  "liveDatabaseBytes",
  "schemaVersion",
  "maintenanceOperationId",
  "backupManifestSha256",
  "recoveryPointRelativePath",
  "recoveryPointSha256",
  "recoveryPointBytes",
  "candidateRelativePath",
  "candidateSha256",
  "candidateBytes",
  "rollbackRelativePath",
  "confirmation",
  "checks",
].sort();

const allowedChecks = new Set([
  "checkpoint",
  "sourceIntegrity",
  "sourceSchema",
  "encryptedRoundTrip",
  "recoveryPointIntegrity",
  "recoveryPointSchema",
  "candidateIntegrity",
  "candidateSchema",
  "candidateAdministrator",
  "candidateEncryption",
  "candidateAudit",
  "swap",
  "onlineVerification",
  "rollback",
]);

const candidateRequiredPhases = new Set<RecoveryReceiptPhase>([
  "candidate_ready",
  "swap_started",
  "swapped",
  "verified",
  "rollback_started",
  "rolled_back",
  "post_complete_failed",
]);

const phaseTransitions: Readonly<Record<RecoveryReceiptPhase, readonly RecoveryReceiptPhase[]>> = {
  recovery_point_ready: ["candidate_ready", "failed"],
  candidate_ready: ["swap_started", "failed"],
  swap_started: ["swapped", "failed", "rollback_started"],
  swapped: ["verified", "failed", "post_complete_failed", "rollback_started"],
  verified: [],
  rollback_started: ["rolled_back", "failed"],
  rolled_back: [],
  failed: ["rollback_started"],
  post_complete_failed: ["rollback_started"],
};

function fail(code: string, message: string, exitCode = 7): never {
  throw new RecoveryError(code, exitCode, message);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validTimestamp(value: unknown, now: number): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && milliseconds <= now
    && new Date(milliseconds).toISOString() === value;
}

function validRelativePath(value: unknown): value is string {
  if (typeof value !== "string"
      || !value
      || value.length > 4096
      || value.includes("\0")
      || isAbsolute(value)) return false;
  const segments = value.split(/[\\/]+/u);
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validOperationId(value: unknown, prefix: "recovery" | "maintenance"): value is string {
  return typeof value === "string"
    && new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "u").test(value);
}

function validateChecks(value: unknown): Readonly<Record<string, "ok">> {
  if (!plainObject(value)) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  const entries = Object.entries(value);
  if (entries.length < 1
      || entries.length > allowedChecks.size
      || entries.some(([key, outcome]) => !allowedChecks.has(key) || outcome !== "ok")) {
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
  const checks: Record<string, "ok"> = {};
  for (const [key] of entries.sort(([left], [right]) => left.localeCompare(right))) checks[key] = "ok";
  return Object.freeze(checks);
}

function candidateBindingState(value: Record<string, unknown>): "absent" | "present" | "invalid" {
  const values = [
    value.candidateRelativePath,
    value.candidateSha256,
    value.candidateBytes,
    value.rollbackRelativePath,
  ];
  if (values.every((item) => item === null)) return "absent";
  if (validRelativePath(value.candidateRelativePath)
      && validHash(value.candidateSha256)
      && Number.isSafeInteger(value.candidateBytes)
      && Number(value.candidateBytes) > 0
      && validRelativePath(value.rollbackRelativePath)
      && value.candidateRelativePath !== value.liveDatabaseRelativePath
      && value.rollbackRelativePath !== value.liveDatabaseRelativePath
      && value.rollbackRelativePath !== value.candidateRelativePath) {
    return "present";
  }
  return "invalid";
}

function deepFreezeReceipt(value: Omit<RecoveryReceipt, "checks"> & { checks: Readonly<Record<string, "ok">> }): RecoveryReceipt {
  return Object.freeze({ ...value, checks: Object.freeze({ ...value.checks }) });
}

export function validateRecoveryReceipt(
  value: unknown,
  options: { now?: number } = {},
): RecoveryReceipt {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || !plainObject(value) || !exactKeys(value, receiptKeys)) {
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
  if (value.format !== "portal-offline-recovery-receipt"
      || value.version !== 1
      || !validOperationId(value.operationId, "recovery")
      || !validTimestamp(value.createdAt, now)
      || !validTimestamp(value.updatedAt, now)
      || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
      || !RECOVERY_RECEIPT_PHASES.includes(value.phase as RecoveryReceiptPhase)
      || !validRelativePath(value.liveDatabaseRelativePath)
      || !validHash(value.liveDatabaseSha256)
      || !Number.isSafeInteger(value.liveDatabaseBytes)
      || Number(value.liveDatabaseBytes) < 1
      || !Number.isSafeInteger(value.schemaVersion)
      || Number(value.schemaVersion) < 1
      || !validOperationId(value.maintenanceOperationId, "maintenance")
      || !validHash(value.backupManifestSha256)
      || !validRelativePath(value.recoveryPointRelativePath)
      || !validHash(value.recoveryPointSha256)
      || !Number.isSafeInteger(value.recoveryPointBytes)
      || Number(value.recoveryPointBytes) < 1
      || value.confirmation !== `RESTORE PORTAL DATABASE ${value.operationId}`) {
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
  const bindingState = candidateBindingState(value);
  if (bindingState === "invalid"
      || (candidateRequiredPhases.has(value.phase as RecoveryReceiptPhase) && bindingState !== "present")) {
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
  const checks = validateChecks(value.checks);
  if (bindingState === "present" && [
    "candidateIntegrity",
    "candidateSchema",
    "candidateAdministrator",
    "candidateEncryption",
    "candidateAudit",
  ].some((key) => checks[key] !== "ok")) {
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
  return deepFreezeReceipt({
    format: "portal-offline-recovery-receipt",
    version: 1,
    operationId: value.operationId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    phase: value.phase as RecoveryReceiptPhase,
    liveDatabaseRelativePath: value.liveDatabaseRelativePath,
    liveDatabaseSha256: value.liveDatabaseSha256,
    liveDatabaseBytes: Number(value.liveDatabaseBytes),
    schemaVersion: Number(value.schemaVersion),
    maintenanceOperationId: value.maintenanceOperationId,
    backupManifestSha256: value.backupManifestSha256,
    recoveryPointRelativePath: value.recoveryPointRelativePath,
    recoveryPointSha256: value.recoveryPointSha256,
    recoveryPointBytes: Number(value.recoveryPointBytes),
    candidateRelativePath: bindingState === "present" ? value.candidateRelativePath : null,
    candidateSha256: bindingState === "present" ? value.candidateSha256 : null,
    candidateBytes: bindingState === "present" ? Number(value.candidateBytes) : null,
    rollbackRelativePath: bindingState === "present" ? value.rollbackRelativePath : null,
    confirmation: value.confirmation,
    checks,
  });
}

export function createRecoveryReceipt(input: RecoveryReceiptInput): RecoveryReceipt {
  if (!plainObject(input)) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  return validateRecoveryReceipt({
    format: "portal-offline-recovery-receipt",
    version: 1,
    ...input,
    candidateRelativePath: null,
    candidateSha256: null,
    candidateBytes: null,
    rollbackRelativePath: null,
    updatedAt: input.createdAt,
    phase: "recovery_point_ready",
  }, { now: Date.parse(input.createdAt as string) });
}

export function bindRecoveryCandidateReceipt(
  receiptValue: unknown,
  binding: RecoveryCandidateReceiptBinding,
  updatedAt: string,
): RecoveryReceipt {
  const now = Date.parse(updatedAt);
  const receipt = validateRecoveryReceipt(receiptValue, { now });
  if (receipt.phase !== "recovery_point_ready"
      || !plainObject(binding)
      || !plainObject(binding.checks)
      || !validRelativePath(binding.candidateRelativePath)
      || !validHash(binding.candidateSha256)
      || !Number.isSafeInteger(binding.candidateBytes)
      || binding.candidateBytes < 1
      || !validRelativePath(binding.rollbackRelativePath)
      || !validTimestamp(updatedAt, now)
      || Date.parse(updatedAt) <= Date.parse(receipt.updatedAt)) {
    fail("recovery_receipt_phase_invalid", "Recovery receipt phase transition is invalid");
  }
  const checks = {
    ...receipt.checks,
    candidateIntegrity: binding.checks.candidateIntegrity,
    candidateSchema: binding.checks.candidateSchema,
    candidateAdministrator: binding.checks.candidateAdministrator,
    candidateEncryption: binding.checks.candidateEncryption,
    candidateAudit: binding.checks.candidateAudit,
  };
  return validateRecoveryReceipt({
    ...receipt,
    phase: "candidate_ready",
    updatedAt,
    candidateRelativePath: binding.candidateRelativePath,
    candidateSha256: binding.candidateSha256,
    candidateBytes: binding.candidateBytes,
    rollbackRelativePath: binding.rollbackRelativePath,
    checks,
  }, { now });
}

export function transitionRecoveryReceipt(
  receiptValue: unknown,
  phase: RecoveryReceiptPhase,
  updatedAt: string,
): RecoveryReceipt {
  const now = Date.parse(updatedAt);
  const receipt = validateRecoveryReceipt(receiptValue, { now });
  if (phase === "candidate_ready"
      || !RECOVERY_RECEIPT_PHASES.includes(phase)
      || !phaseTransitions[receipt.phase].includes(phase)
      || !validTimestamp(updatedAt, now)
      || Date.parse(updatedAt) <= Date.parse(receipt.updatedAt)) {
    fail("recovery_receipt_phase_invalid", "Recovery receipt phase transition is invalid");
  }
  return validateRecoveryReceipt({ ...receipt, phase, updatedAt }, { now });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function validateReceiptFile(path: string): Promise<void> {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || path.length > 4096) {
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
    if ((metadata.mode & 0o777) !== 0o600) {
      fail("recovery_receipt_permissions_invalid", "Recovery receipt permissions are invalid");
    }
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
}

export async function loadRecoveryReceipt(
  path: string,
  options: { now?: number } = {},
): Promise<RecoveryReceipt> {
  await validateReceiptFile(path);
  try {
    const canonicalPath = await realpath(path);
    if (canonicalPath !== path) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
    const contents = await readFile(path, "utf8");
    if (!contents.endsWith("\n") || contents.length > 1_048_576) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
    const value = JSON.parse(contents.slice(0, -1)) as unknown;
    const receipt = validateRecoveryReceipt(value, options);
    if (`${canonicalJson(receipt)}\n` !== contents) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
    return receipt;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeRecoveryReceiptAtomic(
  path: string,
  receiptValue: unknown,
  dependencies: RecoveryReceiptWriteDependencies = {},
): Promise<RecoveryReceipt> {
  const receipt = validateRecoveryReceipt(receiptValue);
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || path.length > 4096) {
    fail("recovery_receipt_invalid", "Recovery receipt is invalid");
  }
  const directory = dirname(path);
  const fileName = basename(path);
  let tempPath = "";
  try {
    const directoryMetadata = await lstat(directory);
    if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
      fail("recovery_receipt_invalid", "Recovery receipt is invalid");
    }
    try {
      const target = await lstat(path);
      if (target.isSymbolicLink() || !target.isFile()) fail("recovery_receipt_invalid", "Recovery receipt is invalid");
      if ((target.mode & 0o777) !== 0o600) {
        fail("recovery_receipt_permissions_invalid", "Recovery receipt permissions are invalid");
      }
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    tempPath = join(directory, `.${fileName}.${randomUUID()}.tmp`);
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    try {
      await handle.writeFile(`${canonicalJson(receipt)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await (dependencies.rename ?? rename)(tempPath, path);
    tempPath = "";
    await syncDirectory(directory);
    return receipt;
  } catch (error) {
    if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    fail("recovery_receipt_write_failed", "Recovery receipt could not be written");
  }
}
