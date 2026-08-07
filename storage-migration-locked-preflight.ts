import {
  DEFAULT_MIGRATION_LOCK_TTL_MS,
  renewPortalMigrationLock,
} from "./db/portal-migration-lock.ts";
import {
  inspectStorageMigrationPreflight,
  unavailableStorageMigrationPreflightReport,
} from "./storage-migration-preflight.ts";
import type { StorageMigrationPreflightReport } from "./storage-migration-preflight-contract.ts";

type MigrationEnv = { DB?: D1Database };
type PreflightDependencies = NonNullable<Parameters<typeof inspectStorageMigrationPreflight>[1]>;

function lockLost(report: StorageMigrationPreflightReport): StorageMigrationPreflightReport {
  return {
    ...report,
    state: "blocked",
    decision: "deny",
    code: "migration_apply_lock_lost",
    lock: {
      state: "held",
      blocking: true,
      ageMs: null,
      ttlMs: DEFAULT_MIGRATION_LOCK_TTL_MS,
      code: "migration_apply_lock_lost",
    },
  };
}

export async function inspectStorageMigrationPreflightWithOwnedLock(
  env: MigrationEnv,
  owner: string,
  dependencies: PreflightDependencies = {},
): Promise<StorageMigrationPreflightReport> {
  const generatedAt = dependencies.now?.() ?? Date.now();
  if (!env.DB || typeof owner !== "string" || owner.length < 1 || owner.length > 160) {
    return unavailableStorageMigrationPreflightReport(generatedAt, 0);
  }
  const options = { now: dependencies.now };
  if (!await renewPortalMigrationLock(env.DB, owner, options).catch(() => false)) {
    return lockLost(unavailableStorageMigrationPreflightReport(generatedAt, 0));
  }
  let report: StorageMigrationPreflightReport | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let evaluated = false;
    const sourceNow = dependencies.now ?? Date.now;
    report = await inspectStorageMigrationPreflight(env, {
      ...dependencies,
      now: () => {
        evaluated = true;
        return sourceNow();
      },
      inspectLock: async () => ({
        state: "available",
        blocking: false,
        ageMs: null,
        ttlMs: DEFAULT_MIGRATION_LOCK_TTL_MS,
      }),
    });
    if (evaluated) break;
    report = null;
  }
  if (!report) return lockLost(unavailableStorageMigrationPreflightReport(generatedAt, 0));
  if (!await renewPortalMigrationLock(env.DB, owner, options).catch(() => false)) return lockLost(report);
  return report;
}
