import {
  inspectPortalSchemaSnapshot,
  type PortalMigration,
} from "./portal-migrations.ts";
import {
  ensurePortalSchemaWithManagedRegistry,
  inspectPortalSchemaWithManagedRegistry,
  type ManagedPortalSchemaStatus,
} from "./portal-controlled-migrations.ts";
import {
  portalMigrationV5SecondaryStatements,
  portalMigrationV5Statements,
  portalMigrationV5TableStatements,
} from "./portal-migration-v5.ts";
import { portalLoginRateLimitsTable } from "./portal-login-rate-limit-schema.ts";
import { portalMigrationsV4, cumulativePortalMigrationSnapshot } from "./portal-migrations-v4.ts";
import {
  validatePortalMigrationRegistry,
  withMigrationMode,
  type ManagedPortalMigration,
} from "./portal-migration-registry.ts";

type MigrationEnv = { DB?: D1Database };
type MigrationOptions = Parameters<typeof ensurePortalSchemaWithManagedRegistry>[2];

async function checksum(version: number, name: string, statements: readonly string[]): Promise<string> {
  const material = JSON.stringify({ version, name, statements });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const loginRateLimitMigration = withMigrationMode({
  version: 5,
  name: "local-login-rate-limit",
  statements: portalMigrationV5Statements,
  tableStatements: portalMigrationV5TableStatements,
  secondaryStatements: portalMigrationV5SecondaryStatements,
  snapshot: {
    tables: [portalLoginRateLimitsTable],
    indexes: [],
    triggers: [],
  },
  checksum: () => checksum(5, "local-login-rate-limit", portalMigrationV5Statements),
} satisfies PortalMigration, "automatic");

export const portalMigrationsV5 = Object.freeze([
  ...portalMigrationsV4,
  loginRateLimitMigration,
]) satisfies readonly ManagedPortalMigration[];

validatePortalMigrationRegistry(portalMigrationsV5);

function incompatible(
  status: ManagedPortalSchemaStatus,
  drift: { compatible: string[]; incompatible: string[] },
): ManagedPortalSchemaStatus {
  return {
    ...status,
    state: "incompatible",
    compatibleDrift: drift.compatible,
    incompatibleDrift: drift.incompatible,
    errorCode: "schema_incompatible_drift",
  };
}

async function verifyV5Schema(env: MigrationEnv, status: ManagedPortalSchemaStatus): Promise<ManagedPortalSchemaStatus> {
  if ((status.state !== "ready" && status.state !== "pending") || !env.DB) return status;
  const applied = new Set(status.appliedVersions);
  const snapshot = cumulativePortalMigrationSnapshot(portalMigrationsV5.filter((migration) => applied.has(migration.version)));
  if (!snapshot.tables.length && !snapshot.indexes.length && !snapshot.triggers.length) return status;
  try {
    const drift = await inspectPortalSchemaSnapshot(env.DB, snapshot);
    return drift.incompatible.length ? incompatible(status, drift) : { ...status, compatibleDrift: drift.compatible };
  } catch {
    return { ...status, state: "failed", errorCode: "schema_migration_failed" };
  }
}

export async function inspectPortalSchemaV5(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<ManagedPortalSchemaStatus> {
  return verifyV5Schema(env, await inspectPortalSchemaWithManagedRegistry(env, portalMigrationsV5, options));
}

export async function ensurePortalSchemaV5(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<ManagedPortalSchemaStatus> {
  return verifyV5Schema(env, await ensurePortalSchemaWithManagedRegistry(env, portalMigrationsV5, options));
}
