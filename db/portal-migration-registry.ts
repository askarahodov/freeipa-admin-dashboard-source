import { portalMigrationsV3 } from "./portal-migrations-v3.ts";
import type { PortalMigration } from "./portal-migrations.ts";

export type PortalMigrationMode = "automatic" | "controlled";

export type ManagedPortalMigration = PortalMigration & {
  mode: PortalMigrationMode;
};

export type ValidatedPortalMigrationRegistry = {
  all: readonly ManagedPortalMigration[];
  automatic: readonly ManagedPortalMigration[];
  controlled: readonly ManagedPortalMigration[];
};

export class PortalMigrationRegistryError extends Error {
  readonly code = "migration_registry_invalid";

  constructor() {
    super("migration_registry_invalid");
    this.name = "PortalMigrationRegistryError";
  }
}

function fail(): never {
  throw new PortalMigrationRegistryError();
}

function snapshotValid(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as { tables?: unknown; indexes?: unknown; triggers?: unknown };
  return Array.isArray(snapshot.tables)
    && Array.isArray(snapshot.indexes)
    && Array.isArray(snapshot.triggers);
}

function migrationValid(value: unknown, expectedVersion: number): value is ManagedPortalMigration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const migration = value as Partial<ManagedPortalMigration>;
  return migration.version === expectedVersion
    && Number.isSafeInteger(migration.version)
    && typeof migration.name === "string"
    && migration.name.length > 0
    && (migration.mode === "automatic" || migration.mode === "controlled")
    && Array.isArray(migration.statements)
    && migration.statements.length > 0
    && migration.statements.every((statement) => typeof statement === "string" && statement.length > 0)
    && typeof migration.checksum === "function";
}

export function withMigrationMode(
  migration: PortalMigration,
  mode: PortalMigrationMode,
): ManagedPortalMigration {
  return Object.freeze({ ...migration, mode });
}

export function validatePortalMigrationRegistry(
  registry: readonly ManagedPortalMigration[],
): ValidatedPortalMigrationRegistry {
  if (!Array.isArray(registry) || registry.length === 0) fail();

  const all = [...registry];
  let controlledSeen = false;
  for (let index = 0; index < all.length; index += 1) {
    const migration = all[index];
    if (!migrationValid(migration, index + 1)) fail();
    if (migration.mode === "controlled") {
      controlledSeen = true;
      if (!snapshotValid(migration.snapshot)) fail();
    } else if (controlledSeen) {
      fail();
    }
  }

  return {
    all: Object.freeze(all),
    automatic: Object.freeze(all.filter((migration) => migration.mode === "automatic")),
    controlled: Object.freeze(all.filter((migration) => migration.mode === "controlled")),
  };
}

function appliedPrefixLength(
  registry: readonly ManagedPortalMigration[],
  appliedVersions: readonly number[],
): number {
  if (!Array.isArray(appliedVersions) || appliedVersions.length > registry.length) fail();
  for (let index = 0; index < appliedVersions.length; index += 1) {
    if (appliedVersions[index] !== registry[index]?.version) fail();
  }
  return appliedVersions.length;
}

export function automaticPendingMigrations(
  registry: readonly ManagedPortalMigration[],
  appliedVersions: readonly number[],
): readonly ManagedPortalMigration[] {
  const validated = validatePortalMigrationRegistry(registry);
  const applied = appliedPrefixLength(validated.all, appliedVersions);
  return Object.freeze(validated.all.slice(applied).filter((migration) => migration.mode === "automatic"));
}

export function controlledPendingMigrations(
  registry: readonly ManagedPortalMigration[],
  appliedVersions: readonly number[],
): readonly ManagedPortalMigration[] {
  const validated = validatePortalMigrationRegistry(registry);
  const applied = appliedPrefixLength(validated.all, appliedVersions);
  return Object.freeze(validated.all.slice(applied).filter((migration) => migration.mode === "controlled"));
}

export const portalMigrationsV3WithModes = Object.freeze(
  portalMigrationsV3.map((migration) => withMigrationMode(migration, "automatic")),
) satisfies readonly ManagedPortalMigration[];

validatePortalMigrationRegistry(portalMigrationsV3WithModes);
