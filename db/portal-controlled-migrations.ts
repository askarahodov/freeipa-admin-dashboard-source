import {
  ensurePortalSchemaWithRegistry,
  inspectPortalSchemaWithRegistry,
  type PortalMigration,
  type PortalSchemaStatus,
} from "./portal-migrations.ts";
import {
  automaticPendingMigrations,
  controlledPendingMigrations,
  validatePortalMigrationRegistry,
  type ManagedPortalMigration,
  type ValidatedPortalMigrationRegistry,
} from "./portal-migration-registry.ts";

type MigrationEnv = Parameters<typeof inspectPortalSchemaWithRegistry>[0];
type MigrationOptions = Parameters<typeof inspectPortalSchemaWithRegistry>[2];

type InspectDependency = (
  env: MigrationEnv,
  registry: readonly PortalMigration[],
  options?: MigrationOptions,
) => Promise<PortalSchemaStatus>;

type EnsureDependency = (
  env: MigrationEnv,
  registry: readonly PortalMigration[],
  options?: MigrationOptions,
) => Promise<PortalSchemaStatus>;

type ManagedInspectDependencies = { inspect?: InspectDependency };
type ManagedEnsureDependencies = ManagedInspectDependencies & { ensure?: EnsureDependency };

function registryFailure(): PortalSchemaStatus {
  return {
    state: "failed",
    currentVersion: 0,
    latestVersion: 0,
    appliedVersions: [],
    pendingVersions: [],
    compatibleDrift: [],
    incompatibleDrift: [],
    errorCode: "migration_registry_invalid",
    verifiedAt: Date.now(),
  };
}

function fullRegistryStatus(
  source: PortalSchemaStatus,
  registry: readonly ManagedPortalMigration[],
): PortalSchemaStatus {
  const applied = new Set(source.appliedVersions);
  return {
    ...source,
    latestVersion: registry.at(-1)?.version ?? 0,
    pendingVersions: registry.map((migration) => migration.version).filter((version) => !applied.has(version)),
  };
}

function pendingProjection(
  source: PortalSchemaStatus,
  validated: ValidatedPortalMigrationRegistry,
): PortalSchemaStatus {
  const full = fullRegistryStatus(source, validated.all);
  if (full.state !== "ready") return full;
  const automatic = automaticPendingMigrations(validated.all, full.appliedVersions);
  const controlled = controlledPendingMigrations(validated.all, full.appliedVersions);
  if (automatic.length || !controlled.length) return full;
  return {
    ...full,
    state: "pending",
    errorCode: "schema_migration_pending",
  };
}

function validate(
  registry: readonly ManagedPortalMigration[],
): ValidatedPortalMigrationRegistry | null {
  try {
    return validatePortalMigrationRegistry(registry);
  } catch {
    return null;
  }
}

export async function inspectPortalSchemaWithManagedRegistry(
  env: MigrationEnv,
  registry: readonly ManagedPortalMigration[],
  options: MigrationOptions = {},
  dependencies: ManagedInspectDependencies = {},
): Promise<PortalSchemaStatus> {
  const validated = validate(registry);
  if (!validated) return registryFailure();
  const inspect = dependencies.inspect ?? inspectPortalSchemaWithRegistry;
  return pendingProjection(await inspect(env, validated.all, options), validated);
}

export async function ensurePortalSchemaWithManagedRegistry(
  env: MigrationEnv,
  registry: readonly ManagedPortalMigration[],
  options: MigrationOptions = {},
  dependencies: ManagedEnsureDependencies = {},
): Promise<PortalSchemaStatus> {
  const validated = validate(registry);
  if (!validated) return registryFailure();

  const inspect = dependencies.inspect ?? inspectPortalSchemaWithRegistry;
  const ensure = dependencies.ensure ?? ensurePortalSchemaWithRegistry;
  const initial = fullRegistryStatus(await inspect(env, validated.all, options), validated.all);
  if (initial.state === "ready") {
    const automatic = automaticPendingMigrations(validated.all, initial.appliedVersions);
    if (!automatic.length) return pendingProjection(initial, validated);
  } else if (!(initial.state === "failed"
    && initial.errorCode === "schema_migration_failed"
    && initial.appliedVersions.length === 0)) {
    return initial;
  }

  if (!validated.automatic.length) return pendingProjection(initial, validated);
  const automaticStatus = await ensure(env, validated.automatic, options);
  if (automaticStatus.state !== "ready") return fullRegistryStatus(automaticStatus, validated.all);
  return pendingProjection(await inspect(env, validated.all, options), validated);
}
