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
  verifyRestoreStageBinding,
  verifyRestoreStageSecret,
  type RestoreStageOperation,
} from "./backup-restore-stage.ts";
import {
  BackupRestoreStageRepositoryError,
  loadRestoreStage,
  type RestoreStageRecord,
} from "./backup-restore-stage-repository.ts";
import {
  BackupSelectiveRecoveryPointError,
  verifySelectiveRecoveryPoint,
  type VerifiedSelectiveRecoveryPoint,
} from "./backup-selective-recovery-point.ts";
import {
  BackupSelectiveRestorePolicyError,
  validateSelectiveRestoreDomains,
  type SelectiveRestorePolicyResult,
} from "./backup-selective-restore-policy.ts";
import {
  BackupSelectiveWritePlanError,
  buildSelectiveRestoreStatements,
  validateSelectiveRestoreCandidate,
  type SelectiveRestoreAuditRow,
} from "./backup-selective-write-plan.ts";

export class BackupSelectiveRestoreCommitError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupSelectiveRestoreCommitError";
    this.code = code;
    this.status = status;
  }
}

export type SelectiveRestoreCommitInput = {
  operation: RestoreStageOperation;
  document: unknown;
  password: unknown;
  domains: unknown;
  approvalToken: unknown;
  recoveryDocument: unknown;
  recoveryPassword: unknown;
  stageId: unknown;
  stageSecret: unknown;
  acknowledgeRecoverySaved: unknown;
  acknowledgeSessionRevocation?: unknown;
  confirmation: unknown;
};

export type SelectiveRestoreCommitResult = {
  committed: true;
  productionMutated: true;
  operation: RestoreStageOperation;
  stageId: string;
  selectedDomains: PortalBackupDomain[];
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  summary: BackupIsolatedRestoreResult["summary"];
};

type ActorContext = {
  identity: string;
  groups: string[];
};

type CommitDependencies = {
  now?: () => number;
  loadStage?: typeof loadRestoreStage;
  verifySecret?: typeof verifyRestoreStageSecret;
  testRestore?: typeof testRestoreEncryptedBackupImport;
  verifyRecovery?: typeof verifySelectiveRecoveryPoint;
  createBinding?: typeof createRestoreStageBinding;
  verifyBinding?: typeof verifyRestoreStageBinding;
  decryptSource?: (
    document: unknown,
    password: unknown,
    domains: readonly PortalBackupDomain[],
  ) => Promise<Pick<DecryptedEncryptedBackupSelection, "selectedDomains" | "fullPayloads">>;
  validateCandidate?: typeof validateSelectiveRestoreCandidate;
  buildStatements?: typeof buildSelectiveRestoreStatements;
  createAuditId?: () => string;
  createCorrelationId?: () => string;
};

const allowedInputKeys = new Set([
  "operation",
  "document",
  "password",
  "domains",
  "approvalToken",
  "recoveryDocument",
  "recoveryPassword",
  "stageId",
  "stageSecret",
  "acknowledgeRecoverySaved",
  "acknowledgeSessionRevocation",
  "confirmation",
]);
const stageIdPattern = /^restore_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeErrors = new Map<string, { status: number; message: string }>([
  ["backup_request_invalid", { status: 400, message: "Backup restore commit request is invalid" }],
  ["backup_database_unavailable", { status: 503, message: "Backup database is unavailable" }],
  ["backup_schema_incompatible", { status: 409, message: "Backup schema is incompatible" }],
  ["backup_restore_dependency_invalid", { status: 422, message: "Backup restore domain dependencies are invalid" }],
  ["backup_restore_domain_unsupported", { status: 422, message: "Backup restore domain is unsupported" }],
  ["backup_restore_confirmation_required", { status: 422, message: "Backup restore confirmation is required" }],
  ["backup_restore_stage_invalid", { status: 409, message: "Backup restore stage is invalid" }],
  ["backup_restore_stage_expired", { status: 409, message: "Backup restore stage expired" }],
  ["backup_restore_stage_cancelled", { status: 409, message: "Backup restore stage was cancelled" }],
  ["backup_restore_stage_committed", { status: 409, message: "Backup restore stage was already committed" }],
  ["backup_restore_stale", { status: 409, message: "Backup restore preview is stale" }],
  ["backup_recovery_point_invalid", { status: 422, message: "Backup recovery point is invalid" }],
  ["backup_recovery_point_stale", { status: 409, message: "Backup recovery point is stale" }],
  ["backup_restore_admin_required", { status: 422, message: "Restored local authentication requires an active administrator" }],
  ["backup_restore_commit_too_large", { status: 422, message: "Backup restore candidate exceeds atomic commit limits" }],
  ["backup_restore_commit_failed", { status: 500, message: "Backup restore commit failed" }],
]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string, status: number, message: string): never {
  throw new BackupSelectiveRestoreCommitError(code, status, message);
}

function validateInput(value: unknown): SelectiveRestoreCommitInput {
  if (!plainObject(value)
      || Object.keys(value).some((key) => !allowedInputKeys.has(key))
      || (value.operation !== "restore" && value.operation !== "rollback")
      || !Object.hasOwn(value, "document")
      || !Object.hasOwn(value, "password")
      || !Object.hasOwn(value, "domains")
      || !Object.hasOwn(value, "approvalToken")
      || !Object.hasOwn(value, "recoveryDocument")
      || !Object.hasOwn(value, "recoveryPassword")
      || !Object.hasOwn(value, "stageId")
      || !Object.hasOwn(value, "stageSecret")
      || !Object.hasOwn(value, "acknowledgeRecoverySaved")
      || !Object.hasOwn(value, "confirmation")) {
    fail("backup_request_invalid", 400, "Backup restore commit request is invalid");
  }
  return {
    operation: value.operation,
    document: value.document,
    password: value.password,
    domains: value.domains,
    approvalToken: value.approvalToken,
    recoveryDocument: value.recoveryDocument,
    recoveryPassword: value.recoveryPassword,
    stageId: value.stageId,
    stageSecret: value.stageSecret,
    acknowledgeRecoverySaved: value.acknowledgeRecoverySaved,
    acknowledgeSessionRevocation: value.acknowledgeSessionRevocation,
    confirmation: value.confirmation,
  };
}

function validateSchema(schema: BackupPreviewSchema): void {
  if (!schema || schema.state !== "ready"
      || !Number.isSafeInteger(schema.currentVersion)
      || schema.currentVersion < 1) {
    fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
  }
}

function normalizeActor(value: unknown): ActorContext {
  const source = typeof value === "string" ? { identity: value, groups: [] } : value;
  if (!plainObject(source)) fail("backup_request_invalid", 400, "Backup restore commit request is invalid");
  const identity = String(source.identity ?? "").trim();
  if (!identity || identity.length > 320) fail("backup_request_invalid", 400, "Backup restore commit request is invalid");
  const groupsValue = source.groups ?? [];
  if (!Array.isArray(groupsValue) || groupsValue.length > 128) {
    fail("backup_request_invalid", 400, "Backup restore commit request is invalid");
  }
  const groups = [...new Set(groupsValue.map((group) => String(group ?? "").trim()))]
    .filter(Boolean)
    .sort();
  if (groups.some((group) => group.length > 320)) {
    fail("backup_request_invalid", 400, "Backup restore commit request is invalid");
  }
  return { identity, groups };
}

function integer(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail("backup_restore_stage_invalid", 409, "Backup restore stage is invalid");
  }
  return number;
}

function stageId(value: unknown): string {
  if (typeof value !== "string" || !stageIdPattern.test(value)) {
    fail("backup_request_invalid", 400, "Backup restore commit request is invalid");
  }
  return value;
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateConfirmation(
  input: SelectiveRestoreCommitInput,
  policy: SelectiveRestorePolicyResult,
  id: string,
): void {
  const prefix = input.operation === "restore" ? "RESTORE" : "ROLLBACK";
  if (input.acknowledgeRecoverySaved !== true
      || input.confirmation !== `${prefix}:${id}`
      || (policy.selectedDomains.includes("local-auth") && input.acknowledgeSessionRevocation !== true)) {
    fail("backup_restore_confirmation_required", 422, "Backup restore confirmation is required");
  }
}

function validateStage(
  stage: RestoreStageRecord | null,
  input: SelectiveRestoreCommitInput,
  policy: SelectiveRestorePolicyResult,
  actor: ActorContext,
  schema: BackupPreviewSchema,
  id: string,
  now: number,
): RestoreStageRecord {
  if (!stage
      || stage.id !== id
      || stage.actorIdentity !== actor.identity
      || stage.operation !== input.operation
      || !arraysEqual(stage.selectedDomains, policy.selectedDomains)
      || stage.sourceSchemaVersion !== schema.currentVersion
      || stage.currentSchemaVersion !== schema.currentVersion) {
    fail("backup_restore_stage_invalid", 409, "Backup restore stage is invalid");
  }
  if (stage.status === "cancelled") {
    fail("backup_restore_stage_cancelled", 409, "Backup restore stage was cancelled");
  }
  if (stage.status === "committed" || stage.status === "committing") {
    fail("backup_restore_stage_committed", 409, "Backup restore stage was already committed");
  }
  if (stage.status === "expired" || stage.expiresAt <= now) {
    fail("backup_restore_stage_expired", 409, "Backup restore stage expired");
  }
  if (stage.status !== "prepared") {
    fail("backup_restore_stage_invalid", 409, "Backup restore stage is invalid");
  }
  return stage;
}

function resultChanges(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const result = value as { meta?: { changes?: unknown }; changes?: unknown };
  return Number(result.meta?.changes ?? result.changes ?? 0);
}

async function decryptSourceDocument(
  documentValue: unknown,
  password: unknown,
  domains: readonly PortalBackupDomain[],
): Promise<Pick<DecryptedEncryptedBackupSelection, "selectedDomains" | "fullPayloads">> {
  const document = await validateEncryptedBackupDocument(documentValue);
  return decryptEncryptedBackupDomains(document, password, domains);
}

function auditRow(
  input: SelectiveRestoreCommitInput,
  stage: RestoreStageRecord,
  actor: ActorContext,
  isolated: BackupIsolatedRestoreResult,
  now: number,
  dependencies: CommitDependencies,
): SelectiveRestoreAuditRow {
  const action = input.operation === "restore" ? "backup.restore.commit" : "backup.rollback.commit";
  return {
    id: dependencies.createAuditId?.() ?? crypto.randomUUID(),
    createdAt: now,
    correlationId: dependencies.createCorrelationId?.() ?? crypto.randomUUID(),
    actorIdentity: actor.identity,
    actorRole: "admin",
    actorGroupsJson: JSON.stringify(actor.groups),
    action,
    resourceType: "portal_backup",
    resourceId: stage.id,
    schemaVersion: String(isolated.currentSchemaVersion),
    outcome: "success",
    metadataJson: JSON.stringify({
      operation: input.operation,
      domains: isolated.selectedDomains,
      sourceSchemaVersion: isolated.sourceSchemaVersion,
      currentSchemaVersion: isolated.currentSchemaVersion,
      tables: isolated.summary.tables,
      records: isolated.summary.records,
      checks: isolated.summary.checks,
      warnings: isolated.summary.warnings,
    }),
  };
}

function normalizeError(error: unknown): BackupSelectiveRestoreCommitError {
  if (error instanceof BackupSelectiveRestoreCommitError) return error;
  if (error instanceof BackupSelectiveRestorePolicyError
      || error instanceof BackupRestoreStageError
      || error instanceof BackupRestoreStageRepositoryError
      || error instanceof BackupIsolatedRestoreError
      || error instanceof BackupSelectiveRecoveryPointError
      || error instanceof BackupEncryptedPreviewError
      || error instanceof BackupSelectiveWritePlanError) {
    const safe = safeErrors.get(error.code);
    if (safe) return new BackupSelectiveRestoreCommitError(error.code, safe.status, safe.message);
  }
  if (plainObject(error) && typeof error.code === "string") {
    const safe = safeErrors.get(error.code);
    if (safe) return new BackupSelectiveRestoreCommitError(error.code, safe.status, safe.message);
  }
  return new BackupSelectiveRestoreCommitError(
    "backup_restore_commit_failed",
    500,
    "Backup restore commit failed",
  );
}

export async function commitSelectiveProductionRestore(
  env: BackupExportEnv,
  inputValue: unknown,
  schema: BackupPreviewSchema,
  actorValue: unknown,
  sanitizedRegistry: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>,
  fullRegistry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>,
  dependencies: CommitDependencies = {},
): Promise<SelectiveRestoreCommitResult> {
  try {
    const input = validateInput(inputValue);
    if (!env.DB || typeof env.DB.batch !== "function") {
      fail("backup_database_unavailable", 503, "Backup database is unavailable");
    }
    validateSchema(schema);
    const actor = normalizeActor(actorValue);
    const policy = validateSelectiveRestoreDomains(input.domains);
    const id = stageId(input.stageId);
    validateConfirmation(input, policy, id);
    const now = integer((dependencies.now ?? Date.now)());

    const loaded = await (dependencies.loadStage ?? loadRestoreStage)(env.DB, id);
    const stage = validateStage(loaded, input, policy, actor, schema, id, now);
    if (!await (dependencies.verifySecret ?? verifyRestoreStageSecret)(stage.stageSecretHash, input.stageSecret)) {
      fail("backup_restore_stage_invalid", 409, "Backup restore stage is invalid");
    }

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
        || isolated.sourceSchemaVersion !== stage.sourceSchemaVersion
        || isolated.currentSchemaVersion !== stage.currentSchemaVersion
        || !arraysEqual(isolated.selectedDomains, policy.selectedDomains)) {
      fail("backup_restore_stale", 409, "Backup restore preview is stale");
    }

    const recovery: VerifiedSelectiveRecoveryPoint = await (
      dependencies.verifyRecovery ?? verifySelectiveRecoveryPoint
    )(
      env,
      input.recoveryDocument,
      input.recoveryPassword,
      policy,
      schema.currentVersion,
      fullRegistry,
    );
    if (!recovery.verified
        || !arraysEqual(recovery.physicalDomains, policy.physicalDomains)
        || !(dependencies.verifyBinding ?? verifyRestoreStageBinding)(
          stage.recoveryBindingHash,
          recovery.bindingHash,
        )) {
      fail("backup_recovery_point_stale", 409, "Backup recovery point is stale");
    }

    const sourceBinding = await (dependencies.createBinding ?? createRestoreStageBinding)({
      operation: input.operation,
      actorIdentity: actor.identity,
      selectedDomains: policy.selectedDomains,
      sourceApprovalToken: input.approvalToken as string,
      recoveryManifestChecksum: recovery.bindingHash,
      sourceSchemaVersion: isolated.sourceSchemaVersion,
      currentSchemaVersion: isolated.currentSchemaVersion,
      expiresAt: stage.expiresAt,
    });
    if (!(dependencies.verifyBinding ?? verifyRestoreStageBinding)(stage.sourceBindingHash, sourceBinding)) {
      fail("backup_restore_stale", 409, "Backup restore preview is stale");
    }

    const source = await (dependencies.decryptSource ?? decryptSourceDocument)(
      input.document,
      input.password,
      policy.selectedDomains,
    );
    if (!arraysEqual(source.selectedDomains, policy.selectedDomains)) {
      fail("backup_restore_stale", 409, "Backup restore preview is stale");
    }
    (dependencies.validateCandidate ?? validateSelectiveRestoreCandidate)(policy, source.fullPayloads);

    const statements = (dependencies.buildStatements ?? buildSelectiveRestoreStatements)(
      env.DB,
      {
        id: stage.id,
        actorIdentity: actor.identity,
        stageSecretHash: stage.stageSecretHash,
        now,
      },
      policy,
      source.fullPayloads,
      recovery.currentFullPayloads,
      auditRow(input, stage, actor, isolated, now, dependencies),
    );
    const results = await env.DB.batch(statements);
    if (!Array.isArray(results) || results.length !== statements.length) {
      fail("backup_restore_commit_failed", 500, "Backup restore commit failed");
    }
    if (resultChanges(results[0]) !== 1) {
      fail("backup_recovery_point_stale", 409, "Backup recovery point is stale");
    }
    if (resultChanges(results.at(-1)) !== 1) {
      fail("backup_restore_commit_failed", 500, "Backup restore commit failed");
    }

    return {
      committed: true,
      productionMutated: true,
      operation: input.operation,
      stageId: stage.id,
      selectedDomains: [...policy.selectedDomains],
      sourceSchemaVersion: isolated.sourceSchemaVersion,
      currentSchemaVersion: isolated.currentSchemaVersion,
      summary: isolated.summary,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
