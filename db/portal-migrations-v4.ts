import {
  ensurePortalSchemaWithRegistry,
  inspectPortalSchemaSnapshot,
  inspectPortalSchemaWithRegistry,
  type PortalMigration,
  type PortalSchemaSnapshot,
  type PortalSchemaStatus,
} from "./portal-migrations.ts";
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
type MigrationOptions = Parameters<typeof ensurePortalSchemaWithRegistry>[2];

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

function cumulativeSnapshot(registry: readonly ManagedPortalMigration[]): PortalSchemaSnapshot {
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

const v4Snapshot = cumulativeSnapshot(portalMigrationsV4);

function incompatible(
  status: PortalSchemaStatus,
  drift: { compatible: string[]; incompatible: string[] },
): PortalSchemaStatus {
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
  status: PortalSchemaStatus,
): Promise<PortalSchemaStatus> {
  if (status.state !== "ready" || !env.DB) return status;
  try {
    const drift = await inspectPortalSchemaSnapshot(env.DB, v4Snapshot);
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
): Promise<PortalSchemaStatus> {
  return verifyV4Schema(env, await inspectPortalSchemaWithRegistry(env, portalMigrationsV4, options));
}

export async function ensurePortalSchemaV4(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  return verifyV4Schema(env, await ensurePortalSchemaWithRegistry(env, portalMigrationsV4, options));
}
