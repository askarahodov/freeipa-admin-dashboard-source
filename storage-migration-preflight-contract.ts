export const STORAGE_MIGRATION_PREFLIGHT_PATH = "/api/admin/storage/migrations/preflight" as const;

export type StorageMigrationPreflightState = "ready" | "not_required" | "blocked" | "unavailable";
export type StorageMigrationPreflightDecision = "allow" | "deny";

export type StorageMigrationPreflightReport = {
  contractVersion: "1";
  generatedAt: number;
  durationMs: number;
  state: StorageMigrationPreflightState;
  decision: StorageMigrationPreflightDecision;
  code: string;
  pendingMigrationCount: number;
  schema: {
    state: "ready" | "incompatible" | "unavailable";
    currentVersion: number | null;
    latestVersion: number | null;
    code: string;
  };
  journal: {
    state: "valid" | "invalid" | "unavailable";
    appliedCount: number;
    pendingCount: number;
    code: string;
  };
  integrity: {
    state: "healthy" | "failed" | "unsupported" | "unavailable" | "not_required";
    code: string;
  };
  backup: {
    state: "ready" | "missing" | "stale" | "incompatible" | "unavailable" | "not_required";
    ageMs: number | null;
    maxAgeMs: number;
    code: string;
  };
  lock: {
    state: "available" | "held" | "stale" | "unavailable" | "not_required";
    blocking: boolean;
    ageMs: number | null;
    ttlMs: number;
    code: string;
  };
};
