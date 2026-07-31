import {
  canonicalBackupJson,
  PORTAL_BACKUP_DOMAINS,
  sha256Hex,
  type PortalBackupDomain,
} from "./backup-manifest.ts";

export class BackupRestoreStageError extends Error {
  readonly code = "backup_restore_stage_invalid";
  readonly status = 422;

  constructor(message = "Backup restore stage is invalid") {
    super(message);
    this.name = "BackupRestoreStageError";
  }
}

export type RestoreStageOperation = "restore" | "rollback";

export type RestoreStageBindingInput = {
  operation: RestoreStageOperation;
  actorIdentity: string;
  selectedDomains: PortalBackupDomain[];
  sourceApprovalToken: string;
  recoveryManifestChecksum: string;
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  expiresAt: number;
};

type RandomValues = (target: Uint8Array) => Uint8Array;

const strictSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const strictHashPattern = /^[0-9a-f]{64}$/;
const domainSet = new Set<PortalBackupDomain>(PORTAL_BACKUP_DOMAINS);

function fail(): never {
  throw new BackupRestoreStageError();
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function strictSecret(value: unknown): value is string {
  return typeof value === "string" && strictSecretPattern.test(value);
}

function strictHash(value: unknown): value is string {
  return typeof value === "string" && strictHashPattern.test(value);
}

function hashBytes(value: string): Uint8Array {
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function equalHash(leftValue: unknown, rightValue: unknown): boolean {
  const leftValid = strictHash(leftValue);
  const rightValid = strictHash(rightValue);
  const left = hashBytes(leftValid ? leftValue : "0".repeat(64));
  const right = hashBytes(rightValid ? rightValue : "0".repeat(64));
  let difference = leftValid && rightValid ? 0 : 1;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validateBindingInput(value: RestoreStageBindingInput): RestoreStageBindingInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  if (value.operation !== "restore" && value.operation !== "rollback") fail();
  const actorIdentity = String(value.actorIdentity ?? "").trim();
  if (!actorIdentity || actorIdentity.length > 320) fail();
  if (!Array.isArray(value.selectedDomains) || value.selectedDomains.length === 0) fail();
  if (new Set(value.selectedDomains).size !== value.selectedDomains.length) fail();
  if (value.selectedDomains.some((domain) => !domainSet.has(domain))) fail();
  const canonicalDomains = PORTAL_BACKUP_DOMAINS.filter((domain) => value.selectedDomains.includes(domain));
  if (canonicalDomains.length !== value.selectedDomains.length
      || canonicalDomains.some((domain, index) => domain !== value.selectedDomains[index])) fail();
  if (!strictHash(value.sourceApprovalToken) || !strictHash(value.recoveryManifestChecksum)) fail();
  if (!Number.isSafeInteger(value.sourceSchemaVersion) || value.sourceSchemaVersion < 1) fail();
  if (!Number.isSafeInteger(value.currentSchemaVersion) || value.currentSchemaVersion < 1) fail();
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1) fail();
  return {
    operation: value.operation,
    actorIdentity,
    selectedDomains: [...canonicalDomains],
    sourceApprovalToken: value.sourceApprovalToken,
    recoveryManifestChecksum: value.recoveryManifestChecksum,
    sourceSchemaVersion: value.sourceSchemaVersion,
    currentSchemaVersion: value.currentSchemaVersion,
    expiresAt: value.expiresAt,
  };
}

export function createRestoreStageSecret(
  randomValues: RandomValues = (target) => crypto.getRandomValues(target),
): string {
  const bytes = new Uint8Array(32);
  const filled = randomValues(bytes);
  if (!(filled instanceof Uint8Array) || filled.length !== bytes.length) fail();
  return base64Url(filled);
}

export async function hashRestoreStageSecret(value: unknown): Promise<string> {
  if (!strictSecret(value)) fail();
  return sha256Hex(value);
}

export async function verifyRestoreStageSecret(expectedHash: unknown, providedSecret: unknown): Promise<boolean> {
  let providedHash = "";
  if (strictSecret(providedSecret)) providedHash = await sha256Hex(providedSecret);
  return equalHash(expectedHash, providedHash);
}

export function verifyRestoreStageBinding(expectedHash: unknown, providedHash: unknown): boolean {
  return equalHash(expectedHash, providedHash);
}

export async function createRestoreStageBinding(inputValue: RestoreStageBindingInput): Promise<string> {
  const input = validateBindingInput(inputValue);
  return sha256Hex(canonicalBackupJson({
    version: 1,
    operation: input.operation,
    actorIdentity: input.actorIdentity,
    selectedDomains: input.selectedDomains,
    sourceApprovalToken: input.sourceApprovalToken,
    recoveryManifestChecksum: input.recoveryManifestChecksum,
    sourceSchemaVersion: input.sourceSchemaVersion,
    currentSchemaVersion: input.currentSchemaVersion,
    expiresAt: input.expiresAt,
  }));
}
