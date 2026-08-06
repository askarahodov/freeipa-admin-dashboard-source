import type { PublicMigrationOperation } from "./storage-migration-operation.ts";

export const STORAGE_MIGRATION_APPLY_PATH = "/api/admin/storage/migrations/apply";
export const STORAGE_MIGRATION_APPLY_STATUS_PATH = "/api/admin/storage/migrations/apply/status";
export const STORAGE_MIGRATION_RECONCILE_PATH = "/api/admin/storage/migrations/apply/reconcile";
export const STORAGE_MIGRATION_APPLY_CONTRACT_VERSION = "1" as const;

export type StorageMigrationApplyInput = {
  maintenanceOperationId: string;
  controllerSecret: string;
  confirmation: string;
};

export type StorageMigrationApplyContext = {
  correlationId: string;
  actor: { identity: string; role: string; groups: string[] };
};

export type StorageMigrationApplyResult = PublicMigrationOperation;
