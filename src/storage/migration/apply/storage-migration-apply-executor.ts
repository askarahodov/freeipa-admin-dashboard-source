import {
  renewPortalMigrationLock,
  type PortalMigrationLockOptions,
} from "../../../../db/portal-migration-lock.ts";
import type { ManagedPortalMigration } from "../../../../db/portal-migration-registry.ts";
import { cumulativePortalMigrationSnapshot } from "../../../../db/portal-migrations-v4.ts";
import {
  inspectPortalSchemaSnapshot,
  type PortalSchemaSnapshot,
} from "../../../../db/portal-migrations.ts";
import { fail, safeNow, type AuditStatement } from "./storage-migration-apply-context.ts";

function resultChanges(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const source = value as { meta?: { changes?: unknown }; changes?: unknown };
  const changes = Number(source.meta?.changes ?? source.changes ?? 0);
  return Number.isSafeInteger(changes) && changes >= 0 ? changes : 0;
}

async function journalStatement(
  db: D1Database,
  migration: ManagedPortalMigration,
  startedAt: number,
  now: number,
): Promise<D1PreparedStatement> {
  return db.prepare("INSERT INTO portal_schema_migrations (version, name, checksum, applied_at, execution_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(migration.version, migration.name, await migration.checksum(), now, Math.max(0, now - startedAt));
}

function cumulativeSnapshot(
  registry: readonly ManagedPortalMigration[],
  throughVersion: number,
): PortalSchemaSnapshot {
  return cumulativePortalMigrationSnapshot(registry.filter((migration) => migration.version <= throughVersion));
}

export async function applyControlledMigrationWithOwnedLock(
  db: D1Database,
  migration: ManagedPortalMigration,
  owner: string,
  operationId: string,
  appliedCount: number,
  audit: readonly AuditStatement[],
  registry: readonly ManagedPortalMigration[],
  options: PortalMigrationLockOptions & { now?: () => number } = {},
): Promise<void> {
  const nowFn = options.now ?? Date.now;
  const startedAt = safeNow(nowFn);
  const renew = async () => {
    if (!await renewPortalMigrationLock(db, owner, options)) fail("migration_apply_lock_lost", 409);
  };

  if (migration.tableStatements?.length) {
    await renew();
    await db.batch(migration.tableStatements.map((statement) => db.prepare(statement)));
    await renew();
    const tableDrift = await inspectPortalSchemaSnapshot(db, migration.snapshot!, { secondary: false, extras: false });
    if (tableDrift.incompatible.length) fail("migration_apply_partial_state", 409);
    await renew();
    const secondaryDrift = await inspectPortalSchemaSnapshot(db, migration.snapshot!, {
      secondary: true,
      extras: false,
      allowMissingSecondary: true,
    });
    if (secondaryDrift.incompatible.length) fail("migration_apply_partial_state", 409);
  }

  await renew();
  const completedAt = safeNow(nowFn);
  const statements = migration.tableStatements?.length
    ? [...(migration.secondaryStatements ?? []).map((sql) => db.prepare(sql))]
    : migration.statements.map((sql) => db.prepare(sql));
  const journal = await journalStatement(db, migration, startedAt, completedAt);
  const progress = db.prepare(`UPDATE portal_migration_operations
    SET applied_count = ?, updated_at = ?
    WHERE id = 'main' AND state = 'running' AND operation_id = ?
      AND applied_count = ? AND ? <= total_count`)
    .bind(appliedCount, completedAt, operationId, appliedCount - 1, appliedCount);
  const batch = [...statements, journal, progress, ...audit];
  const results = await db.batch(batch);
  const progressIndex = statements.length + 1;
  if (!Array.isArray(results) || results.length !== batch.length || resultChanges(results[progressIndex]) !== 1) {
    fail("migration_apply_failed", 503);
  }
  await renew();
  const drift = await inspectPortalSchemaSnapshot(db, cumulativeSnapshot(registry, migration.version));
  if (drift.incompatible.length) fail("migration_apply_partial_state", 409);
}
