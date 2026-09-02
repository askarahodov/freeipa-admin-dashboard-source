import {
  BackupEncryptedPreviewError,
  decryptEncryptedBackupDomains,
  validateEncryptedBackupDocument,
  type DecryptedEncryptedBackupSelection,
} from "./backup-encrypted-preview.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "./src/backup/export/backup-export.ts";
import type { FullBackupDomainExporter } from "./backup-full-domains.ts";
import {
  BackupIsolatedRestoreError,
  testRestoreEncryptedBackupImport,
  type BackupIsolatedRestoreResult,
} from "./backup-isolated-restore.ts";
import type { BackupPreviewSchema } from "./backup-import-preview.ts";
import type { PortalBackupDomain } from "./backup-manifest.ts";
import {
  BackupRestoreStageError,
  createRestoreStageBinding,
  createRestoreStageSecret,
  hashRestoreStageSecret,
  type RestoreStageOperation,
} from "./backup-restore-stage.ts";
import {
  BackupRestoreStageRepositoryError,
  createRestoreStage,
  type CreateRestoreStageInput,
  type RestoreStageRecord,
} from "./backup-restore-stage-repository.ts";
import {
  BackupSelectiveRecoveryPointError,
  createSelectiveRecoveryPoint,
  verifySelectiveRecoveryPoint,
  type SelectiveRecoveryPointResult,
  type VerifiedSelectiveRecoveryPoint,
} from "./backup-selective-recovery-point.ts";
import {
  BackupSelectiveRestorePolicyError,
  validateSelectiveRestoreDomains,
} from "./backup-selective-restore-policy.ts";
import {
  BackupSelectiveWritePlanError,
  validateSelectiveRestoreCandidate,
} from "./backup-selective-write-plan.ts";

export class BackupSelectiveRestorePrepareError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupSelectiveRestorePrepareError";
    this.code = code;
    this.status = status;
  }
}

export type SelectiveRestorePrepareInput = {
  operation: RestoreStageOperation;
  document: unknown;
  password: unknown;
  domains: unknown;
  approvalToken: unknown;
  recoveryPassword: unknown;
};

export type SelectiveRestorePrepareResult = {
  prepared: true;
  productionMutated: false;
  operation: RestoreStageOperation;
  selectedDomains: PortalBackupDomain[];
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  stage: { id: string; secret: string; expiresAt: number };
  isolated: BackupIsolatedRestoreResult;
  recovery: {
    document: SelectiveRecoveryPointResult["document"];
    summary: SelectiveRecoveryPointResult["summary"];
  };
};

type PrepareDependencies = {
  testRestore?: typeof testRestoreEncryptedBackupImport;
  decryptSource?: (
    document: unknown,
    password: unknown,
    domains: readonly PortalBackupDomain[],
  ) => Promise<Pick<DecryptedEncryptedBackupSelection, "selectedDomains" | "fullPayloads">>;
  validateCandidate?: typeof validateSelectiveRestoreCandidate;
  createRecovery?: typeof createSelectiveRecoveryPoint;
  verifyRecovery?: typeof verifySelectiveRecoveryPoint;
  createSecret?: typeof createRestoreStageSecret;
  hashSecret?: typeof hashRestoreStageSecret;
  createBinding?: typeof createRestoreStageBinding;
  createId?: () => string;
  now?: () => number;
  createStage?: (
    db: D1Database,
    input: CreateRestoreStageInput,
  ) => Promise<RestoreStageRecord>;
};

const allowedInputKeys = new Set([
  "operation",
  "document",
  "password",
  "domains",
  "approvalToken",
  "recoveryPassword",
]);
const safeErrors = new Map<string, { status: number; message: string }>([
  ["backup_request_invalid", { status: 400, message: "Backup restore prepare request is invalid" }],
  ["backup_database_unavailable", { status: 503, message: "Backup database is unavailable" }],
  ["backup_schema_incompatible", { status: 409, message: "Backup schema is incompatible" }],
  ["backup_restore_dependency_invalid", { status: 422, message: "Backup restore domain dependencies are invalid" }],
  ["backup_restore_domain_unsupported", { status: 422, message: "Backup restore domain is unsupported" }],
  ["backup_restore_stale", { status: 409, message: "Backup restore preview is stale" }],
  ["backup_restore_admin_required", { status: 422, message: "Restored local authentication requires an active administrator" }],
  ["backup_restore_commit_failed", { status: 422, message: "Backup restore candidate cannot be committed" }],
  ["backup_restore_commit_too_large", { status: 422, message: "Backup restore candidate exceeds atomic commit limits" }],
  ["backup_recovery_point_invalid", { status: 422, message: "Backup recovery point is invalid" }],
  ["backup_recovery_point_stale", { status: 409, message: "Backup recovery point is stale" }],
  ["backup_restore_stage_invalid", { status: 409, message: "Backup restore stage is invalid" }],
]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string, status: number, message: string): never {
  throw new BackupSelectiveRestorePrepareError(code, status, message);
}

function validateInput(value: unknown): SelectiveRestorePrepareInput {
  if (!plainObject(value)
      || Object.keys(value).some((key) => !allowedInputKeys.has(key))
      || value.operation !== "restore" && value.operation !== "rollback"
      || !Object.hasOwn(value, "document")
      || !Object.hasOwn(value, "password")
      || !Object.hasOwn(value, "domains")
      || !Object.hasOwn(value, "approvalToken")
      || !Object.hasOwn(value, "recoveryPassword")) {
    fail("backup_request_invalid", 400, "Backup restore prepare request is invalid");
  }
  return {
    operation: value.operation as RestoreStageOperation,
    document: value.document,
    password: value.password,
    domains: value.domains,
    approvalToken: value.approvalToken,
    recoveryPassword: value.recoveryPassword,
  };
}

function validateSchema(schema: BackupPreviewSchema): void {
  if (!schema || schema.state !== "ready"
      || !Number.isSafeInteger(schema.currentVersion)
      || schema.currentVersion < 1) {
    fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
  }
}

function actorIdentity(value: unknown): string {
  const actor = String(value ?? "").trim();
  if (!actor || actor.length > 320) fail("backup_request_invalid", 400, "Backup restore prepare request is invalid");
  return actor;
}

function nowValue(value: unknown): number {
  const now = Number(value);
  if (!Number.isSafeInteger(now) || now < 1) fail("backup_restore_stage_invalid", 409, "Backup restore stage is invalid");
  return now;
}

function stageId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^restore_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    fail("backup_restore_stage_invalid", 409, "Backup restore stage is invalid");
  }
  return id;
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function decryptSourceDocument(
  documentValue: unknown,
  password: unknown,
  domains: readonly PortalBackupDomain[],
): Promise<Pick<DecryptedEncryptedBackupSelection, "selectedDomains" | "fullPayloads">> {
  const document = await validateEncryptedBackupDocument(documentValue);
  return decryptEncryptedBackupDomains(document, password, domains);
}

function normalizeError(error: unknown): BackupSelectiveRestorePrepareError {
  if (error instanceof BackupSelectiveRestorePrepareError) return error;
  if (error instanceof BackupSelectiveRestorePolicyError
      || error instanceof BackupIsolatedRestoreError
      || error instanceof BackupEncryptedPreviewError
      || error instanceof BackupSelectiveWritePlanError
      || error instanceof BackupSelectiveRecoveryPointError
      || error instanceof BackupRestoreStageError
      || error instanceof BackupRestoreStageRepositoryError) {
    const safe = safeErrors.get(error.code);
    if (safe) return new BackupSelectiveRestorePrepareError(error.code, safe.status, safe.message);
  }
  if (plainObject(error) && typeof error.code === "string") {
    const safe = safeErrors.get(error.code);
    if (safe) return new BackupSelectiveRestorePrepareError(error.code, safe.status, safe.message);
  }
  return new BackupSelectiveRestorePrepareError(
    "backup_restore_commit_failed",
    500,
    "Backup restore prepare failed",
  );
}

export async function prepareSelectiveProductionRestore(
  env: BackupExportEnv,
  inputValue: unknown,
  schema: BackupPreviewSchema,
  actorValue: unknown,
  sanitizedRegistry: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>,
  fullRegistry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>,
  dependencies: PrepareDependencies = {},
): Promise<SelectiveRestorePrepareResult> {
  try {
    const input = validateInput(inputValue);
    if (!env.DB) fail("backup_database_unavailable", 503, "Backup database is unavailable");
    validateSchema(schema);
    const actor = actorIdentity(actorValue);
    const policy = validateSelectiveRestoreDomains(input.domains);
    const validateCandidate = dependencies.validateCandidate ?? validateSelectiveRestoreCandidate;

    const isolated = await (dependencies.testRestore ?? testRestoreEncryptedBackupImport)(
      env,
      {
        document: input.document,
        password: input.password,
        domains: policy.selectedDomains,
        approvalToken: input.approvalToken,
      },
      schema,
      sanitizedRegistry,
      fullRegistry,
    );
    if (!isolated.canCommit
        || isolated.currentSchemaVersion !== schema.currentVersion
        || isolated.sourceSchemaVersion !== schema.currentVersion
        || !arraysEqual(isolated.selectedDomains, policy.selectedDomains)) {
      fail("backup_restore_commit_failed", 422, "Backup restore candidate cannot be committed");
    }

    const source = await (dependencies.decryptSource ?? decryptSourceDocument)(
      input.document,
      input.password,
      policy.selectedDomains,
    );
    if (!arraysEqual(source.selectedDomains, policy.selectedDomains)) {
      fail("backup_restore_stale", 409, "Backup restore preview is stale");
    }
    validateCandidate(policy, source.fullPayloads);

    const recovery = await (dependencies.createRecovery ?? createSelectiveRecoveryPoint)(
      env,
      input.recoveryPassword,
      policy,
      schema.currentVersion,
      fullRegistry,
    );
    const verified: VerifiedSelectiveRecoveryPoint = await (
      dependencies.verifyRecovery ?? verifySelectiveRecoveryPoint
    )(
      env,
      recovery.document,
      input.recoveryPassword,
      policy,
      schema.currentVersion,
      fullRegistry,
    );
    if (!verified.verified
        || verified.bindingHash !== recovery.bindingHash
        || !arraysEqual(verified.physicalDomains, policy.physicalDomains)) {
      fail("backup_recovery_point_invalid", 422, "Backup recovery point is invalid");
    }
    validateCandidate(policy, verified.currentFullPayloads);

    const now = nowValue((dependencies.now ?? Date.now)());
    const expiresAt = now + 15 * 60 * 1000;
    const id = stageId((dependencies.createId ?? (() => `restore_${crypto.randomUUID()}`))());
    const secret = (dependencies.createSecret ?? createRestoreStageSecret)();
    const stageSecretHash = await (dependencies.hashSecret ?? hashRestoreStageSecret)(secret);
    const sourceBindingHash = await (dependencies.createBinding ?? createRestoreStageBinding)({
      operation: input.operation,
      actorIdentity: actor,
      selectedDomains: policy.selectedDomains,
      sourceApprovalToken: input.approvalToken as string,
      recoveryManifestChecksum: recovery.bindingHash,
      sourceSchemaVersion: isolated.sourceSchemaVersion,
      currentSchemaVersion: isolated.currentSchemaVersion,
      expiresAt,
    });
    await (dependencies.createStage ?? createRestoreStage)(env.DB, {
      id,
      operation: input.operation,
      actorIdentity: actor,
      selectedDomains: policy.selectedDomains,
      stageSecretHash,
      sourceBindingHash,
      recoveryBindingHash: recovery.bindingHash,
      sourceSchemaVersion: isolated.sourceSchemaVersion,
      currentSchemaVersion: isolated.currentSchemaVersion,
      createdAt: now,
      expiresAt,
    });

    return {
      prepared: true,
      productionMutated: false,
      operation: input.operation,
      selectedDomains: [...policy.selectedDomains],
      sourceSchemaVersion: isolated.sourceSchemaVersion,
      currentSchemaVersion: isolated.currentSchemaVersion,
      stage: { id, secret, expiresAt },
      isolated,
      recovery: { document: recovery.document, summary: recovery.summary },
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
