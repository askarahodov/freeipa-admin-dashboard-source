import { PORTAL_BACKUP_DOMAINS } from "../../../../backup-manifest.ts";
import {
  DEFAULT_MIGRATION_LOCK_TTL_MS,
  inspectPortalMigrationLock,
  type PortalMigrationLockInspection,
} from "../../../../db/portal-migration-lock.ts";
import { portalMigrationsV3 } from "../../../../db/portal-migrations-v3.ts";
import {
  inspectPortalSchemaSnapshot,
  type PortalMigration,
  type PortalSchemaSnapshot,
} from "../../../../db/portal-migrations.ts";
import type { StorageMigrationPreflightReport } from "./storage-migration-preflight-contract.ts";
import { inspectStorageQuickCheck, type StorageQuickCheckResult } from "../../integrity/storage-quick-check.ts";

const MAX_BACKUP_AGE_MS = 86_400_000;
const MAX_PUBLIC_DURATION_MS = 60_000;
const MAX_PUBLIC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PUBLIC_COUNT = 10_000;

type MigrationEnv = { DB?: D1Database };
type JournalRow = {
  version: unknown;
  name: unknown;
  checksum: unknown;
  applied_at?: unknown;
  execution_ms?: unknown;
};
type SchemaObjectRow = {
  name?: unknown;
  type?: unknown;
  tbl_name?: unknown;
  sql?: unknown;
};
type BackupAuditRow = {
  created_at?: unknown;
  schema_version?: unknown;
  metadata_json?: unknown;
};
type BackupCandidate = {
  createdAt: number;
  schemaVersion: number;
  domains: unknown;
};
type AppliedSchemaResult = {
  state: "ready" | "incompatible" | "unavailable";
  code: string;
};
type PreflightDependencies = {
  registry?: readonly PortalMigration[];
  now?: () => number;
  readJournal?: (env: MigrationEnv, registry: readonly PortalMigration[]) => Promise<JournalRow[]>;
  inspectAppliedSchema?: (
    env: MigrationEnv,
    applied: readonly PortalMigration[],
  ) => Promise<AppliedSchemaResult>;
  detectPartialFuture?: (
    env: MigrationEnv,
    pending: readonly PortalMigration[],
  ) => Promise<boolean>;
  quickCheck?: (env: MigrationEnv) => Promise<StorageQuickCheckResult>;
  readBackupCandidates?: (env: MigrationEnv) => Promise<BackupCandidate[]>;
  inspectLock?: (env: MigrationEnv) => Promise<PortalMigrationLockInspection>;
};
type ValidJournal = {
  rows: Array<{ version: number; name: string; checksum: string }>;
  applied: readonly PortalMigration[];
  pending: readonly PortalMigration[];
};
type JournalValidation =
  | { ok: true; value: ValidJournal }
  | { ok: false; code: string; appliedCount: number };
type SnapshotObject = {
  name: string;
  type: "table" | "index" | "trigger";
  table: string;
  sql: string;
  columns?: readonly {
    name: string;
    type: string;
    notNull: boolean;
    primaryKey: boolean;
  }[];
};

let inFlight: Promise<StorageMigrationPreflightReport> | null = null;

function safeInteger(value: unknown, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, maximum);
}

function safeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safeDuration(startedAt: number, completedAt: number): number {
  return safeInteger(completedAt - startedAt, MAX_PUBLIC_DURATION_MS);
}

function normalizedIdentifier(value: unknown): string {
  return String(value ?? "").trim().replace(/^["`\[]|["`\]]$/g, "").toLowerCase();
}

function snapshotObjects(migrations: readonly PortalMigration[]): SnapshotObject[] | null {
  const byKey = new Map<string, SnapshotObject>();
  for (const migration of migrations) {
    if (!migration.snapshot) return null;
    for (const table of migration.snapshot.tables) {
      byKey.set(`table:${normalizedIdentifier(table.name)}`, {
        name: table.name,
        type: "table",
        table: table.name,
        sql: table.sql,
        columns: table.columns,
      });
    }
    for (const index of migration.snapshot.indexes) {
      byKey.set(`index:${normalizedIdentifier(index.name)}`, {
        name: index.name,
        type: "index",
        table: index.table,
        sql: index.sql,
      });
    }
    for (const trigger of migration.snapshot.triggers) {
      byKey.set(`trigger:${normalizedIdentifier(trigger.name)}`, {
        name: trigger.name,
        type: "trigger",
        table: trigger.table,
        sql: trigger.sql,
      });
    }
  }
  return [...byKey.values()];
}

function snapshotSchema(migrations: readonly PortalMigration[]): PortalSchemaSnapshot | null {
  const objects = snapshotObjects(migrations);
  if (!objects) return null;
  return {
    tables: objects
      .filter((item) => item.type === "table")
      .map((item) => ({ name: item.name, sql: item.sql, columns: item.columns ?? [] })),
    indexes: objects
      .filter((item) => item.type === "index")
      .map((item) => ({ name: item.name, table: item.table, sql: item.sql })),
    triggers: objects
      .filter((item) => item.type === "trigger")
      .map((item) => ({ name: item.name, table: item.table, sql: item.sql })),
  };
}

async function schemaObjects(env: MigrationEnv): Promise<SchemaObjectRow[]> {
  if (!env.DB) throw new Error("database unavailable");
  const result = await env.DB.prepare(
    "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 1001",
  ).all<SchemaObjectRow>();
  const results = result.results ?? [];
  if (results.length > 1000) throw new Error("schema inventory overflow");
  return results;
}

async function defaultInspectAppliedSchema(
  env: MigrationEnv,
  applied: readonly PortalMigration[],
): Promise<AppliedSchemaResult> {
  const snapshot = snapshotSchema(applied);
  if (!snapshot) return { state: "incompatible", code: "migration_registry_snapshot_required" };
  if (!env.DB) return { state: "unavailable", code: "migration_schema_unavailable" };
  try {
    await schemaObjects(env);
    const drift = await inspectPortalSchemaSnapshot(env.DB, snapshot);
    return drift.incompatible.length
      ? { state: "incompatible", code: "migration_schema_incompatible" }
      : { state: "ready", code: "migration_schema_ready" };
  } catch {
    return { state: "unavailable", code: "migration_schema_unavailable" };
  }
}

async function defaultDetectPartialFuture(
  env: MigrationEnv,
  pending: readonly PortalMigration[],
): Promise<boolean> {
  const expected = snapshotObjects(pending);
  if (!expected) throw new Error("snapshot unavailable");
  const present = new Set(
    (await schemaObjects(env)).map((row) => (
      `${normalizedIdentifier(row.type)}:${normalizedIdentifier(row.name)}`
    )),
  );
  return expected.some((item) => present.has(`${item.type}:${normalizedIdentifier(item.name)}`));
}

async function defaultReadJournal(
  env: MigrationEnv,
  registry: readonly PortalMigration[],
): Promise<JournalRow[]> {
  if (!env.DB) throw new Error("database unavailable");
  const limit = Math.min(registry.length + 1, 1_001);
  const result = await env.DB.prepare(
    `SELECT version, name, checksum, applied_at, execution_ms FROM portal_schema_migrations ORDER BY version ASC LIMIT ${limit}`,
  ).all<JournalRow>();
  return result.results ?? [];
}

async function defaultQuickCheck(env: MigrationEnv): Promise<StorageQuickCheckResult> {
  if (!env.DB) return { state: "unavailable" };
  return inspectStorageQuickCheck({
    async first(sql) {
      return await env.DB!.prepare(sql).first<Record<string, unknown>>();
    },
  });
}

async function defaultReadBackupCandidates(env: MigrationEnv): Promise<BackupCandidate[]> {
  if (!env.DB) throw new Error("database unavailable");
  const result = await env.DB.prepare(
    "SELECT created_at, schema_version, metadata_json FROM portal_audit_events WHERE action = ? AND outcome = ? AND resource_type = ? ORDER BY created_at DESC LIMIT 20",
  ).bind("backup.encrypted.export.completed", "success", "portal-backup").all<BackupAuditRow>();
  return (result.results ?? []).map((row) => {
    let metadata: unknown = null;
    try {
      metadata = typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : null;
    } catch {
      metadata = null;
    }
    const domains = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as { domains?: unknown }).domains
      : null;
    return {
      createdAt: Number(row.created_at),
      schemaVersion: Number(row.schema_version),
      domains,
    };
  });
}

async function defaultInspectLock(env: MigrationEnv): Promise<PortalMigrationLockInspection> {
  if (!env.DB) {
    return {
      state: "unavailable",
      blocking: true,
      ageMs: null,
      ttlMs: DEFAULT_MIGRATION_LOCK_TTL_MS,
    };
  }
  return inspectPortalMigrationLock(env.DB);
}

async function validateJournal(
  rows: readonly JournalRow[],
  registry: readonly PortalMigration[],
): Promise<JournalValidation> {
  const normalized: Array<{ version: number; name: string; checksum: string }> = [];
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.version)
      || Number(row.version) < 1
      || typeof row.name !== "string"
      || !row.name
      || typeof row.checksum !== "string"
      || !row.checksum
    ) {
      return { ok: false, code: "migration_journal_malformed", appliedCount: normalized.length };
    }
    normalized.push({ version: Number(row.version), name: row.name, checksum: row.checksum });
  }

  const versions = normalized.map((row) => row.version);
  if (new Set(versions).size !== versions.length) {
    return { ok: false, code: "migration_journal_duplicate", appliedCount: normalized.length };
  }
  if (normalized.length > registry.length || versions.some((version) => !registry.some((item) => item.version === version))) {
    return { ok: false, code: "migration_journal_future_version", appliedCount: normalized.length };
  }
  const expectedPrefix = registry.slice(0, normalized.length);
  if (normalized.some((row, index) => row.version !== expectedPrefix[index]?.version)) {
    return { ok: false, code: "migration_journal_gap", appliedCount: normalized.length };
  }
  for (let index = 0; index < normalized.length; index += 1) {
    const expected = expectedPrefix[index];
    const row = normalized[index];
    if (row.name !== expected.name || row.checksum !== await expected.checksum()) {
      return { ok: false, code: "migration_journal_checksum_mismatch", appliedCount: normalized.length };
    }
  }
  return {
    ok: true,
    value: {
      rows: normalized,
      applied: expectedPrefix,
      pending: registry.slice(normalized.length),
    },
  };
}

function fullDomainSet(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== PORTAL_BACKUP_DOMAINS.length) return false;
  if (value.some((domain) => typeof domain !== "string")) return false;
  const domains = new Set(value);
  return domains.size === PORTAL_BACKUP_DOMAINS.length
    && PORTAL_BACKUP_DOMAINS.every((domain) => domains.has(domain));
}

function backupResult(
  candidates: readonly BackupCandidate[],
  currentVersion: number,
  now: number,
): StorageMigrationPreflightReport["backup"] {
  let staleAge: number | null = null;
  let incompatible = false;
  for (const candidate of candidates.slice(0, 20)) {
    const createdAt = safeTimestamp(candidate.createdAt);
    if (createdAt === null || createdAt > now || !Number.isSafeInteger(candidate.schemaVersion)) {
      incompatible = true;
      continue;
    }
    if (candidate.schemaVersion !== currentVersion || !fullDomainSet(candidate.domains)) {
      incompatible = true;
      continue;
    }
    const rawAge = now - createdAt;
    const ageMs = Math.min(rawAge, MAX_PUBLIC_AGE_MS);
    if (rawAge <= MAX_BACKUP_AGE_MS) {
      return {
        state: "ready",
        ageMs,
        maxAgeMs: MAX_BACKUP_AGE_MS,
        code: "migration_backup_ready",
      };
    }
    staleAge = staleAge === null ? ageMs : Math.min(staleAge, ageMs);
  }
  if (staleAge !== null) {
    return {
      state: "stale",
      ageMs: staleAge,
      maxAgeMs: MAX_BACKUP_AGE_MS,
      code: "migration_backup_stale",
    };
  }
  if (incompatible) {
    return {
      state: "incompatible",
      ageMs: null,
      maxAgeMs: MAX_BACKUP_AGE_MS,
      code: "migration_backup_incompatible",
    };
  }
  return {
    state: "missing",
    ageMs: null,
    maxAgeMs: MAX_BACKUP_AGE_MS,
    code: "migration_backup_missing",
  };
}

function integrityResult(result: StorageQuickCheckResult): StorageMigrationPreflightReport["integrity"] {
  switch (result.state) {
    case "healthy": return { state: "healthy", code: "migration_quick_check_ok" };
    case "failed": return { state: "failed", code: "migration_quick_check_failed" };
    case "unsupported": return { state: "unsupported", code: "migration_quick_check_unsupported" };
    case "unavailable": return { state: "unavailable", code: "migration_quick_check_unavailable" };
  }
}

function lockResult(result: PortalMigrationLockInspection): StorageMigrationPreflightReport["lock"] {
  const ageMs = result.ageMs === null ? null : safeInteger(result.ageMs, MAX_PUBLIC_AGE_MS);
  const ttlMs = Math.max(1_000, Math.min(safeInteger(result.ttlMs, 600_000), 600_000));
  switch (result.state) {
    case "available":
      return { state: "available", blocking: false, ageMs: null, ttlMs, code: "migration_lock_available" };
    case "held":
      return { state: "held", blocking: true, ageMs, ttlMs, code: "migration_lock_held" };
    case "stale":
      return { state: "stale", blocking: false, ageMs, ttlMs, code: "migration_lock_stale" };
    case "unavailable":
      return { state: "unavailable", blocking: true, ageMs: null, ttlMs, code: "migration_lock_unavailable" };
  }
}

function baseReport(
  generatedAt: number,
  durationMs: number,
  registry: readonly PortalMigration[],
): StorageMigrationPreflightReport {
  return {
    contractVersion: "1",
    generatedAt: safeInteger(generatedAt, Number.MAX_SAFE_INTEGER),
    durationMs: safeInteger(durationMs, MAX_PUBLIC_DURATION_MS),
    state: "unavailable",
    decision: "deny",
    code: "migration_preflight_unavailable",
    pendingMigrationCount: 0,
    schema: {
      state: "unavailable",
      currentVersion: null,
      latestVersion: registry.at(-1)?.version ?? null,
      code: "migration_schema_unavailable",
    },
    journal: {
      state: "unavailable",
      appliedCount: 0,
      pendingCount: 0,
      code: "migration_journal_unavailable",
    },
    integrity: { state: "unavailable", code: "migration_quick_check_unavailable" },
    backup: {
      state: "unavailable",
      ageMs: null,
      maxAgeMs: MAX_BACKUP_AGE_MS,
      code: "migration_backup_unavailable",
    },
    lock: {
      state: "unavailable",
      blocking: true,
      ageMs: null,
      ttlMs: DEFAULT_MIGRATION_LOCK_TTL_MS,
      code: "migration_lock_unavailable",
    },
  };
}

export function unavailableStorageMigrationPreflightReport(
  generatedAt: number,
  durationMs: number,
): StorageMigrationPreflightReport {
  return baseReport(generatedAt, durationMs, portalMigrationsV3);
}

function blockedCode(
  integrity: StorageMigrationPreflightReport["integrity"],
  backup: StorageMigrationPreflightReport["backup"],
  lock: StorageMigrationPreflightReport["lock"],
): string | null {
  if (integrity.state !== "healthy") return integrity.code;
  if (backup.state !== "ready") return backup.code;
  if (lock.blocking) return lock.code;
  return null;
}

function noPendingReport(
  report: StorageMigrationPreflightReport,
  generatedAt: number,
  completedAt: number,
  schema: StorageMigrationPreflightReport["schema"],
  journal: StorageMigrationPreflightReport["journal"],
): StorageMigrationPreflightReport {
  return {
    ...report,
    state: "not_required",
    decision: "deny",
    code: "migration_preflight_not_required",
    durationMs: safeDuration(generatedAt, completedAt),
    pendingMigrationCount: 0,
    schema,
    journal,
    integrity: { state: "not_required", code: "migration_quick_check_not_required" },
    backup: {
      state: "not_required",
      ageMs: null,
      maxAgeMs: MAX_BACKUP_AGE_MS,
      code: "migration_backup_not_required",
    },
    lock: {
      state: "not_required",
      blocking: false,
      ageMs: null,
      ttlMs: DEFAULT_MIGRATION_LOCK_TTL_MS,
      code: "migration_lock_not_required",
    },
  };
}

async function evaluateStorageMigrationPreflight(
  env: MigrationEnv,
  dependencies: PreflightDependencies,
): Promise<StorageMigrationPreflightReport> {
  const now = dependencies.now ?? Date.now;
  const generatedAt = safeInteger(now(), Number.MAX_SAFE_INTEGER);
  const registry = dependencies.registry ?? portalMigrationsV3;
  const report = baseReport(generatedAt, 0, registry);
  if (!env.DB) {
    return {
      ...report,
      code: "migration_preflight_database_unavailable",
      durationMs: safeDuration(generatedAt, now()),
    };
  }

  let validation: JournalValidation;
  try {
    validation = await validateJournal(
      await (dependencies.readJournal ?? defaultReadJournal)(env, registry),
      registry,
    );
  } catch {
    return {
      ...report,
      code: "migration_journal_unavailable",
      durationMs: safeDuration(generatedAt, now()),
    };
  }

  if (!validation.ok) {
    return {
      ...report,
      state: "blocked",
      code: validation.code,
      durationMs: safeDuration(generatedAt, now()),
      journal: {
        state: "invalid",
        appliedCount: safeInteger(validation.appliedCount, MAX_PUBLIC_COUNT),
        pendingCount: 0,
        code: validation.code,
      },
    };
  }

  const { applied, pending } = validation.value;
  const currentVersion = applied.at(-1)?.version ?? 0;
  const latestVersion = registry.at(-1)?.version ?? 0;
  const journal = {
    state: "valid" as const,
    appliedCount: safeInteger(applied.length, MAX_PUBLIC_COUNT),
    pendingCount: safeInteger(pending.length, MAX_PUBLIC_COUNT),
    code: "migration_journal_valid",
  };

  let inspectedSchema: AppliedSchemaResult;
  try {
    inspectedSchema = await (dependencies.inspectAppliedSchema ?? defaultInspectAppliedSchema)(env, applied);
  } catch {
    inspectedSchema = { state: "unavailable", code: "migration_schema_unavailable" };
  }
  if (inspectedSchema.state !== "ready") {
    return {
      ...report,
      state: inspectedSchema.state === "unavailable" ? "unavailable" : "blocked",
      code: inspectedSchema.code,
      durationMs: safeDuration(generatedAt, now()),
      pendingMigrationCount: safeInteger(pending.length, MAX_PUBLIC_COUNT),
      schema: {
        state: inspectedSchema.state,
        currentVersion,
        latestVersion,
        code: inspectedSchema.code,
      },
      journal,
    };
  }

  const publicSchema = {
    state: "ready" as const,
    currentVersion,
    latestVersion,
    code: "migration_schema_ready",
  };

  if (pending.length === 0) {
    return noPendingReport(report, generatedAt, now(), publicSchema, journal);
  }

  if (pending.some((migration) => !migration.snapshot)) {
    return {
      ...report,
      state: "blocked",
      decision: "deny",
      code: "migration_registry_snapshot_required",
      durationMs: safeDuration(generatedAt, now()),
      pendingMigrationCount: safeInteger(pending.length, MAX_PUBLIC_COUNT),
      schema: {
        state: "incompatible",
        currentVersion,
        latestVersion,
        code: "migration_registry_snapshot_required",
      },
      journal,
    };
  }

  try {
    if (await (dependencies.detectPartialFuture ?? defaultDetectPartialFuture)(env, pending)) {
      return {
        ...report,
        state: "blocked",
        code: "migration_schema_partial_apply",
        durationMs: safeDuration(generatedAt, now()),
        pendingMigrationCount: safeInteger(pending.length, MAX_PUBLIC_COUNT),
        schema: {
          state: "incompatible",
          currentVersion,
          latestVersion,
          code: "migration_schema_partial_apply",
        },
        journal,
      };
    }
  } catch {
    return {
      ...report,
      code: "migration_schema_unavailable",
      durationMs: safeDuration(generatedAt, now()),
      pendingMigrationCount: safeInteger(pending.length, MAX_PUBLIC_COUNT),
      schema: {
        state: "unavailable",
        currentVersion,
        latestVersion,
        code: "migration_schema_unavailable",
      },
      journal,
    };
  }

  const quickCheck = await (dependencies.quickCheck ?? defaultQuickCheck)(env)
    .catch(() => ({ state: "unavailable" as const }));
  const integrity = integrityResult(quickCheck);

  let backup: StorageMigrationPreflightReport["backup"];
  try {
    backup = backupResult(
      await (dependencies.readBackupCandidates ?? defaultReadBackupCandidates)(env),
      currentVersion,
      generatedAt,
    );
  } catch {
    backup = {
      state: "unavailable",
      ageMs: null,
      maxAgeMs: MAX_BACKUP_AGE_MS,
      code: "migration_backup_unavailable",
    };
  }

  const lock = lockResult(await (dependencies.inspectLock ?? defaultInspectLock)(env).catch(() => ({
    state: "unavailable" as const,
    blocking: true,
    ageMs: null,
    ttlMs: DEFAULT_MIGRATION_LOCK_TTL_MS,
  })));
  const blocking = blockedCode(integrity, backup, lock);

  return {
    ...report,
    state: blocking
      ? (integrity.state === "unavailable"
          || backup.state === "unavailable"
          || lock.state === "unavailable"
          ? "unavailable"
          : "blocked")
      : "ready",
    decision: blocking ? "deny" : "allow",
    code: blocking ?? "migration_preflight_ready",
    durationMs: safeDuration(generatedAt, now()),
    pendingMigrationCount: safeInteger(pending.length, MAX_PUBLIC_COUNT),
    schema: publicSchema,
    journal,
    integrity,
    backup,
    lock,
  };
}

export function inspectStorageMigrationPreflight(
  env: MigrationEnv,
  dependencies: PreflightDependencies = {},
): Promise<StorageMigrationPreflightReport> {
  if (inFlight) return inFlight;
  const evaluation = evaluateStorageMigrationPreflight(env, dependencies);
  const wrapped = evaluation.finally(() => {
    if (inFlight === wrapped) inFlight = null;
  });
  inFlight = wrapped;
  return wrapped;
}
