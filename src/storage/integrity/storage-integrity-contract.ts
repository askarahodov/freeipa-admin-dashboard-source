export const STORAGE_INTEGRITY_PATH = "/api/admin/storage/integrity/check" as const;

export type StorageIntegrityState = "healthy" | "degraded" | "unavailable";

export type StorageIntegrityQuickCheck = {
  state: "healthy" | "failed" | "unsupported" | "unavailable";
  code:
    | "storage_quick_check_ok"
    | "storage_quick_check_failed"
    | "storage_quick_check_unsupported"
    | "storage_quick_check_unavailable";
};

export type StorageIntegrityIndexes = {
  expected: number;
  present: number;
  missing: number;
  mismatched: number;
  unexpected: number;
  code:
    | "storage_indexes_ready"
    | "storage_indexes_degraded"
    | "storage_indexes_unavailable";
};

export type StorageIntegrityReport = {
  contractVersion: "1";
  generatedAt: number;
  durationMs: number;
  state: StorageIntegrityState;
  quickCheck: StorageIntegrityQuickCheck;
  indexes: StorageIntegrityIndexes;
};
