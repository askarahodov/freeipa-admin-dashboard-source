import {
  acquirePortalMigrationLock,
  releasePortalMigrationLock,
} from "../../../../db/portal-migration-lock.ts";
import { validatePortalMigrationRegistry } from "../../../../db/portal-migration-registry.ts";
import {
  beginMigrationOperation,
  completeMigrationOperation,
  failMigrationOperation,
  loadMigrationOperation,
  markMigrationInterrupted,
  markMigrationReconciled,
} from "../operation/storage-migration-operation-repository.ts";
import {
  createMigrationOperationId,
  migrationApplyConfirmation,
  publicMigrationOperation,
  type MigrationOperationRow,
} from "../operation/storage-migration-operation.ts";
import { inspectStorageQuickCheck } from "../../integrity/storage-quick-check.ts";
import type {
  StorageMigrationApplyContext,
  StorageMigrationApplyInput,
  StorageMigrationApplyResult,
} from "./storage-migration-apply-contract.ts";
import { applyControlledMigrationWithOwnedLock } from "./storage-migration-apply-executor.ts";
import {
  StorageMigrationApplyError,
  defaultClassifyReconciliation,
  defaultFinalSchema,
  defaultInspectPlan,
  defaultLockedPreflight,
  defaultMarkMaintenanceFailed,
  defaultRegistry,
  defaultVerifyMaintenance,
  fail,
  failedRow,
  inspectMigrationApplyStatus,
  interruptedRow,
  prepareMigrationAuditStatement,
  reconciledRow,
  safeError,
  safeNow,
  safeReportPlan,
  succeededRow,
  type ApplyDependencies,
  type AuditStatement,
  type MigrationEnv,
} from "./storage-migration-apply-context.ts";

export { StorageMigrationApplyError, inspectMigrationApplyStatus, prepareMigrationAuditStatement };
export { applyControlledMigrationWithOwnedLock };

export async function applyControlledStorageMigrations(
  env: MigrationEnv,
  context: StorageMigrationApplyContext,
  input: StorageMigrationApplyInput,
  dependencies: ApplyDependencies = {},
): Promise<StorageMigrationApplyResult> {
  if (!env.DB) fail("migration_apply_database_unavailable", 503);
  const db = env.DB;
  const now = dependencies.now ?? Date.now;
  const registry = dependencies.registry ?? defaultRegistry;
  try { validatePortalMigrationRegistry(registry); } catch { fail("migration_apply_registry_invalid", 503); }
  await (dependencies.verifyMaintenance ?? defaultVerifyMaintenance)(db, input, "apply");

  const plan = safeReportPlan(await (dependencies.inspectPlan ?? defaultInspectPlan)(env, registry), registry);
  if (input.confirmation !== migrationApplyConfirmation(input.maintenanceOperationId, plan.currentVersion, plan.targetVersion)) {
    fail("migration_apply_confirmation_required", 422);
  }
  const previous = await (dependencies.loadOperation ?? loadMigrationOperation)(db);
  if (previous && (previous.state === "running" || previous.state === "failed")) {
    fail("migration_apply_operation_conflict", 409);
  }

  const operationId = (dependencies.createOperationId ?? createMigrationOperationId)();
  let startAudit: AuditStatement;
  try {
    startAudit = await (dependencies.prepareAudit ?? prepareMigrationAuditStatement)(
      db,
      "storage.migration.apply.started",
      context,
      {
        outcome: "pending",
        operationId,
        schemaVersion: plan.currentVersion,
        metadata: { fromVersion: plan.currentVersion, targetVersion: plan.targetVersion, totalCount: plan.pending.length },
      },
      safeNow(now),
    );
  } catch {
    fail("migration_apply_audit_unavailable", 503);
  }

  const owner = (dependencies.createOwner ?? crypto.randomUUID)();
  const acquire = dependencies.acquireLock ?? acquirePortalMigrationLock;
  const release = dependencies.releaseLock ?? releasePortalMigrationLock;
  let acquired = false;
  let started = false;
  let running: MigrationOperationRow | null = null;
  let pendingError: StorageMigrationApplyError | null = null;
  try {
    acquired = await acquire(db, owner, { now });
    if (!acquired) fail("migration_apply_busy", 409);
    const locked = safeReportPlan(
      await (dependencies.inspectLockedPreflight ?? defaultLockedPreflight)(env, owner, registry),
      registry,
    );
    if (locked.currentVersion !== plan.currentVersion
      || locked.targetVersion !== plan.targetVersion
      || locked.pending.length !== plan.pending.length) {
      fail("migration_apply_preflight_blocked", 422);
    }

    running = await (dependencies.beginOperation ?? beginMigrationOperation)(db, {
      operationId,
      maintenanceOperationId: input.maintenanceOperationId,
      fromVersion: plan.currentVersion,
      targetVersion: plan.targetVersion,
      totalCount: plan.pending.length,
      now: safeNow(now),
    }, [startAudit]);
    started = true;

    for (let index = 0; index < plan.pending.length; index += 1) {
      const migration = plan.pending[index];
      const count = index + 1;
      let progressAudit: AuditStatement;
      try {
        progressAudit = await (dependencies.prepareAudit ?? prepareMigrationAuditStatement)(
          db,
          "storage.migration.apply.progress",
          context,
          {
            outcome: "success",
            operationId,
            schemaVersion: migration.version,
            metadata: { appliedCount: count, totalCount: plan.pending.length },
          },
          safeNow(now),
        );
      } catch {
        fail("migration_apply_audit_unavailable", 503);
      }
      await (dependencies.applyMigration ?? applyControlledMigrationWithOwnedLock)(
        db,
        migration,
        owner,
        operationId,
        count,
        [progressAudit],
        registry,
        { now },
      );
    }

    if (!await (dependencies.inspectFinalSchema ?? defaultFinalSchema)(env, registry)) {
      fail("migration_apply_verification_failed", 500);
    }
    const quick = await (dependencies.quickCheck ?? inspectStorageQuickCheck)(env)
      .catch(() => ({ state: "unavailable" as const }));
    if (quick.state !== "healthy") fail("migration_apply_verification_failed", 500);

    let completionAudit: AuditStatement;
    try {
      completionAudit = await (dependencies.prepareAudit ?? prepareMigrationAuditStatement)(
        db,
        "storage.migration.apply.completed",
        context,
        { outcome: "success", operationId, schemaVersion: plan.targetVersion, metadata: { appliedCount: plan.pending.length } },
        safeNow(now),
      );
    } catch {
      fail("migration_apply_audit_unavailable", 503);
    }
    await (dependencies.completeOperation ?? completeMigrationOperation)(
      db,
      operationId,
      plan.pending.length,
      safeNow(now),
      [completionAudit],
    );
    return publicMigrationOperation(succeededRow(running, safeNow(now)), context.correlationId);
  } catch (error) {
    pendingError = safeError(error);
    if (started && running) {
      const failureCode = pendingError.code === "migration_apply_verification_failed"
        ? "migration_apply_verification_failed"
        : pendingError.code === "migration_apply_lock_lost"
          ? "migration_apply_lock_lost"
          : "migration_apply_failed";
      let audit: AuditStatement[] = [];
      try {
        audit = [await (dependencies.prepareAudit ?? prepareMigrationAuditStatement)(
          db,
          "storage.migration.apply.failed",
          context,
          {
            outcome: "failure",
            operationId,
            errorCode: failureCode,
            metadata: { appliedCount: running.appliedCount, totalCount: running.totalCount },
          },
          safeNow(now),
        )];
      } catch {}
      await (dependencies.failOperation ?? failMigrationOperation)(
        db,
        operationId,
        failureCode,
        safeNow(now),
        audit,
      ).catch(() => {});
      await (dependencies.markMaintenanceFailed ?? defaultMarkMaintenanceFailed)(
        db,
        failureCode,
        safeNow(now),
      ).catch(() => {});
    }
    throw pendingError;
  } finally {
    if (acquired) {
      try {
        await release(db, owner);
      } catch {
        if (!pendingError) throw new StorageMigrationApplyError("migration_apply_failed", 503);
      }
    }
  }
}

export async function reconcileControlledStorageMigration(
  env: MigrationEnv,
  context: StorageMigrationApplyContext,
  input: StorageMigrationApplyInput,
  dependencies: ApplyDependencies = {},
): Promise<StorageMigrationApplyResult> {
  if (!env.DB) fail("migration_apply_database_unavailable", 503);
  const db = env.DB;
  const now = dependencies.now ?? Date.now;
  const registry = dependencies.registry ?? defaultRegistry;
  await (dependencies.verifyMaintenance ?? defaultVerifyMaintenance)(db, input, "reconcile");
  if (input.confirmation !== `RECONCILE:${input.maintenanceOperationId}`) {
    fail("migration_apply_confirmation_required", 422);
  }
  const row = await (dependencies.loadOperation ?? loadMigrationOperation)(db);
  if (!row || row.state === "succeeded" || row.state === "reconciled" || row.state === "interrupted") {
    fail("migration_reconcile_not_required", 409);
  }

  const owner = (dependencies.createOwner ?? crypto.randomUUID)();
  const acquire = dependencies.acquireLock ?? acquirePortalMigrationLock;
  const release = dependencies.releaseLock ?? releasePortalMigrationLock;
  let acquired = false;
  try {
    acquired = await acquire(db, owner, { now });
    if (!acquired) fail("migration_reconcile_busy", 409);
    const classification = await (dependencies.classifyReconciliation ?? defaultClassifyReconciliation)(env, row, registry);
    if (classification.state === "interrupted") {
      const audit = await (dependencies.prepareAudit ?? prepareMigrationAuditStatement)(
        db,
        "storage.migration.reconcile.interrupted",
        context,
        { outcome: "success", operationId: row.operationId },
        safeNow(now),
      );
      await (dependencies.markInterrupted ?? markMigrationInterrupted)(db, row.operationId, safeNow(now), [audit]);
      return publicMigrationOperation(interruptedRow(row, safeNow(now)), context.correlationId);
    }
    if (classification.state === "reconciled") {
      const audit = await (dependencies.prepareAudit ?? prepareMigrationAuditStatement)(
        db,
        "storage.migration.reconcile.completed",
        context,
        { outcome: "success", operationId: row.operationId, schemaVersion: row.targetVersion },
        safeNow(now),
      );
      await (dependencies.markReconciled ?? markMigrationReconciled)(
        db,
        row.operationId,
        classification.appliedCount,
        safeNow(now),
        [audit],
      );
      return publicMigrationOperation(reconciledRow(row, safeNow(now)), context.correlationId);
    }
    const audit = await (dependencies.prepareAudit ?? prepareMigrationAuditStatement)(
      db,
      "storage.migration.reconcile.failed",
      context,
      { outcome: "failure", operationId: row.operationId, errorCode: classification.code },
      safeNow(now),
    );
    await (dependencies.failOperation ?? failMigrationOperation)(
      db,
      row.operationId,
      classification.code,
      safeNow(now),
      [audit],
    );
    return publicMigrationOperation(failedRow(row, safeNow(now), classification.code), context.correlationId);
  } catch (error) {
    if (error instanceof StorageMigrationApplyError) throw error;
    fail("migration_reconcile_failed", 503);
  } finally {
    if (acquired) await release(db, owner).catch(() => {});
  }
}
