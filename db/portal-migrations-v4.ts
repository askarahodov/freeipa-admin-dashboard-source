import {
  inspectPortalSchemaSnapshot,
  type PortalMigration,
  type PortalSchemaSnapshot,
} from "./portal-migrations.ts";
import {
  ensurePortalSchemaWithManagedRegistry,
  inspectPortalSchemaWithManagedRegistry,
  type ManagedPortalSchemaStatus,
} from "./portal-controlled-migrations.ts";
import {
  portalMigrationOperationsTable,
  portalMigrationV4SecondaryStatements,
  portalMigrationV4Statements,
  portalMigrationV4TableStatements,
} from "./portal-migration-v4.ts";
import {
  portalMigrationsV3WithModes,
  validatePortalMigrationRegistry,
  withMigrationMode,
  type ManagedPortalMigration,
} from "./portal-migration-registry.ts";

type MigrationEnv = { DB?: D1Database };
type MigrationOptions = Parameters<typeof ensurePortalSchemaWithManagedRegistry>[2];

async function checksum(
  version: number,
  name: string,
  statements: readonly string[],
): Promise<string> {
  const material = JSON.stringify({ version, name, statements });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const foundationMigration = withMigrationMode({
  version: 4,
  name: "controlled-migration-foundation",
  statements: portalMigrationV4Statements,
  tableStatements: portalMigrationV4TableStatements,
  secondaryStatements: portalMigrationV4SecondaryStatements,
  snapshot: {
    tables: [portalMigrationOperationsTable],
    indexes: [],
    triggers: [],
  },
  checksum: () => checksum(4, "controlled-migration-foundation", portalMigrationV4Statements),
} satisfies PortalMigration, "automatic");

export const portalMigrationsV4 = Object.freeze([
  ...portalMigrationsV3WithModes,
  foundationMigration,
]) satisfies readonly ManagedPortalMigration[];

validatePortalMigrationRegistry(portalMigrationsV4);

export function cumulativePortalMigrationSnapshot(registry: readonly ManagedPortalMigration[]): PortalSchemaSnapshot {
  const tables = new Map<string, PortalSchemaSnapshot["tables"][number]>();
  const indexes = new Map<string, PortalSchemaSnapshot["indexes"][number]>();
  const triggers = new Map<string, PortalSchemaSnapshot["triggers"][number]>();
  for (const migration of registry) {
    for (const table of migration.snapshot?.tables ?? []) tables.set(table.name.toLowerCase(), table);
    for (const index of migration.snapshot?.indexes ?? []) indexes.set(index.name.toLowerCase(), index);
    for (const trigger of migration.snapshot?.triggers ?? []) triggers.set(trigger.name.toLowerCase(), trigger);
  }
  return {
    tables: [...tables.values()],
    indexes: [...indexes.values()],
    triggers: [...triggers.values()],
  };
}

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

async function verifyV4Schema(
  env: MigrationEnv,
  status: ManagedPortalSchemaStatus,
): Promise<ManagedPortalSchemaStatus> {
  if ((status.state !== "ready" && status.state !== "pending") || !env.DB) return status;
  const applied = new Set(status.appliedVersions);
  const snapshot = cumulativePortalMigrationSnapshot(portalMigrationsV4.filter((migration) => applied.has(migration.version)));
  if (!snapshot.tables.length && !snapshot.indexes.length && !snapshot.triggers.length) return status;
  try {
    const drift = await inspectPortalSchemaSnapshot(env.DB, snapshot);
    return drift.incompatible.length
      ? incompatible(status, drift)
      : { ...status, compatibleDrift: drift.compatible };
  } catch {
    return { ...status, state: "failed", errorCode: "schema_migration_failed" };
  }
}

export async function inspectPortalSchemaV4(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<ManagedPortalSchemaStatus> {
  return verifyV4Schema(env, await inspectPortalSchemaWithManagedRegistry(env, portalMigrationsV4, options));
}

export async function ensurePortalSchemaV4(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<ManagedPortalSchemaStatus> {
  return verifyV4Schema(env, await ensurePortalSchemaWithManagedRegistry(env, portalMigrationsV4, options));
}
