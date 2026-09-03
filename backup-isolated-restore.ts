import {
  BackupEncryptedPreviewError,
  decryptEncryptedBackupDomains,
  validateEncryptedBackupDocument,
  type DecryptedEncryptedBackupSelection,
} from "./backup-encrypted-preview.ts";
import type { BackupExportEnv, PortalBackupDomainExporter } from "./src/backup/export/backup-export.ts";
import type { FullBackupDomainExporter } from "./backup-full-domains.ts";
import {
  BackupImportPreviewError,
  previewBackupImport,
  type BackupImportPreviewResult,
  type BackupPreviewSchema,
} from "./src/backup/preview/backup-import-preview.ts";
import {
  BackupIsolatedStoreError,
  stageIsolatedRestore,
  type IsolatedRestoreStore,
} from "./src/backup/restore/backup-isolated-store.ts";
import {
  BackupIsolatedVerificationError,
  verifyIsolatedRestore,
  type IsolatedRestoreVerificationResult,
} from "./src/backup/restore/backup-isolated-verification.ts";
import type { PortalBackupDomain } from "./backup-manifest.ts";
import {
  BackupRestorePlanError,
  createBackupRestorePlan,
  verifyBackupRestoreApprovalToken,
} from "./src/backup/restore/backup-restore-plan.ts";
import {
  BackupRestoreSelectionError,
  selectBackupRestoreDomains,
} from "./src/backup/restore/backup-restore-selection.ts";

export class BackupIsolatedRestoreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupIsolatedRestoreError";
    this.code = code;
    this.status = status;
  }
}

export type BackupIsolatedRestoreInput = {
  document: unknown;
  password: unknown;
  domains: unknown;
  approvalToken: unknown;
};

export type BackupIsolatedRestoreResult = {
  tested: true;
  productionMutated: false;
  selectedDomains: PortalBackupDomain[];
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  canCommit: boolean;
  summary: IsolatedRestoreVerificationResult["summary"];
  domains: IsolatedRestoreVerificationResult["domains"];
};

export type BackupIsolatedRestoreDependencies = {
  validateDocument?: typeof validateEncryptedBackupDocument;
  createPlan?: typeof createBackupRestorePlan;
  verifyToken?: typeof verifyBackupRestoreApprovalToken;
  decryptDomains?: typeof decryptEncryptedBackupDomains;
  preview?: typeof previewBackupImport;
  stageStore?: (payloads: DecryptedEncryptedBackupSelection["fullPayloads"]) => IsolatedRestoreStore;
  verifyStore?: typeof verifyIsolatedRestore;
};

const safeErrors = new Map<string, { status: number; message: string }>([
  ["backup_request_invalid", { status: 400, message: "Backup test restore request is invalid" }],
  ["backup_database_unavailable", { status: 503, message: "Backup database is unavailable" }],
  ["backup_schema_incompatible", { status: 409, message: "Backup schema is incompatible" }],
  ["backup_mode_unsupported", { status: 422, message: "Encrypted backup mode is required" }],
  ["backup_payload_missing", { status: 422, message: "Encrypted backup payload is missing" }],
  ["backup_payload_unexpected", { status: 422, message: "Encrypted backup contains an unexpected payload" }],
  ["backup_corrupted", { status: 422, message: "Encrypted backup is corrupted" }],
  ["backup_decryption_failed", { status: 422, message: "Backup decryption failed" }],
  ["backup_full_payload_invalid", { status: 422, message: "Encrypted backup payload is invalid" }],
  ["backup_document_too_large", { status: 413, message: "Encrypted backup document is too large" }],
  ["backup_restore_stale", { status: 409, message: "Backup restore preview is stale" }],
  ["backup_test_restore_failed", { status: 422, message: "Backup test restore failed" }],
]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string, status: number, message: string): never {
  throw new BackupIsolatedRestoreError(code, status, message);
}

function normalizeError(error: unknown): BackupIsolatedRestoreError {
  if (error instanceof BackupIsolatedRestoreError) return error;
  if (error instanceof BackupRestoreSelectionError) {
    return new BackupIsolatedRestoreError(error.code, error.status, "Backup test restore request is invalid");
  }
  if (error instanceof BackupRestorePlanError
      || error instanceof BackupEncryptedPreviewError
      || error instanceof BackupImportPreviewError) {
    const safe = safeErrors.get(error.code);
    if (safe) return new BackupIsolatedRestoreError(error.code, safe.status, safe.message);
  }
  if (error instanceof BackupIsolatedStoreError
      || error instanceof BackupIsolatedVerificationError) {
    return new BackupIsolatedRestoreError("backup_test_restore_failed", 422, "Backup test restore failed");
  }
  if (plainObject(error) && typeof error.code === "string") {
    const safe = safeErrors.get(error.code);
    if (safe) return new BackupIsolatedRestoreError(error.code, safe.status, safe.message);
  }
  return new BackupIsolatedRestoreError("backup_test_restore_failed", 500, "Backup test restore failed");
}

function validateInput(value: unknown): BackupIsolatedRestoreInput {
  if (!plainObject(value)
      || Object.keys(value).some((key) => !["document", "password", "domains", "approvalToken"].includes(key))
      || !Object.hasOwn(value, "document")
      || !Object.hasOwn(value, "password")
      || !Object.hasOwn(value, "domains")
      || !Object.hasOwn(value, "approvalToken")) {
    fail("backup_request_invalid", 400, "Backup test restore request is invalid");
  }
  return {
    document: value.document,
    password: value.password,
    domains: value.domains,
    approvalToken: value.approvalToken,
  };
}

function validateSchema(schema: BackupPreviewSchema): void {
  if (!schema
      || schema.state !== "ready"
      || !Number.isSafeInteger(schema.currentVersion)
      || schema.currentVersion < 1) {
    fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
  }
}

export async function testRestoreEncryptedBackupImport(
  env: BackupExportEnv,
  inputValue: unknown,
  schema: BackupPreviewSchema,
  sanitizedRegistry: ReadonlyMap<PortalBackupDomain, PortalBackupDomainExporter>,
  fullRegistry: ReadonlyMap<PortalBackupDomain, FullBackupDomainExporter>,
  dependencies: BackupIsolatedRestoreDependencies = {},
): Promise<BackupIsolatedRestoreResult> {
  try {
    const input = validateInput(inputValue);
    if (!env.DB) fail("backup_database_unavailable", 503, "Backup database is unavailable");
    validateSchema(schema);

    const document = await (dependencies.validateDocument ?? validateEncryptedBackupDocument)(input.document);
    if (document.manifest.schemaVersion > schema.currentVersion) {
      fail("backup_schema_incompatible", 409, "Backup schema is incompatible");
    }
    const selectedDomains = selectBackupRestoreDomains(document.manifest.domains, input.domains);
    const expectedPlan = await (dependencies.createPlan ?? createBackupRestorePlan)(
      env,
      document,
      selectedDomains,
      schema.currentVersion,
      fullRegistry,
    );
    if (!(dependencies.verifyToken ?? verifyBackupRestoreApprovalToken)(
      expectedPlan.approvalToken,
      input.approvalToken,
    )) {
      fail("backup_restore_stale", 409, "Backup restore preview is stale");
    }

    const decrypted = await (dependencies.decryptDomains ?? decryptEncryptedBackupDomains)(
      document,
      input.password,
      selectedDomains,
    );
    const preview: BackupImportPreviewResult = await (dependencies.preview ?? previewBackupImport)(
      env,
      decrypted.projected,
      schema,
      sanitizedRegistry,
    );
    const store = (dependencies.stageStore ?? stageIsolatedRestore)(decrypted.fullPayloads);
    const verification = (dependencies.verifyStore ?? verifyIsolatedRestore)(store, {
      sourceSchemaVersion: document.manifest.schemaVersion,
      currentSchemaVersion: schema.currentVersion,
      preview: {
        canRestore: preview.canRestore,
        requiredMigrations: preview.requiredMigrations,
        summary: { conflict: preview.summary.conflict },
      },
    });

    return {
      tested: true,
      productionMutated: false,
      selectedDomains: [...selectedDomains],
      sourceSchemaVersion: document.manifest.schemaVersion,
      currentSchemaVersion: schema.currentVersion,
      canCommit: verification.canCommit,
      summary: verification.summary,
      domains: verification.domains,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}
