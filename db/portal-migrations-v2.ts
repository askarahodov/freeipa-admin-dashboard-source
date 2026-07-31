import {
  ensurePortalSchemaWithRegistry,
  inspectPortalSchemaWithRegistry,
  portalMigrations,
  type PortalMigration,
  type PortalSchemaStatus,
} from "./portal-migrations.ts";
import {
  portalMigrationV2SecondaryStatements,
  portalMigrationV2Statements,
  portalMigrationV2TableStatements,
} from "./portal-migration-v2.ts";
import {
  portalRestoreStageIndex,
  portalRestoreStageTable,
} from "./portal-restore-stage-schema.ts";

const restoreStageMigration: PortalMigration = {
  version: 2,
  name: "backup-restore-stage-metadata",
  statements: portalMigrationV2Statements,
  tableStatements: portalMigrationV2TableStatements,
  secondaryStatements: portalMigrationV2SecondaryStatements,
  snapshot: {
    tables: [portalRestoreStageTable],
    indexes: [portalRestoreStageIndex],
    triggers: [],
  },
  checksum: async () => {
    const material = JSON.stringify({
      version: 2,
      name: "backup-restore-stage-metadata",
      statements: portalMigrationV2Statements,
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
};

export const portalMigrationsV2 = Object.freeze([
  ...portalMigrations,
  restoreStageMigration,
]) satisfies readonly PortalMigration[];

type MigrationEnv = { DB?: D1Database };
type MigrationOptions = Parameters<typeof ensurePortalSchemaWithRegistry>[2];
type TableInfoRow = { name: string; type: string; notnull: number; pk: number };
type SchemaObjectRow = { name: string; type: string; tbl_name: string; sql: string | null };
type ReadyCacheEntry = { expiresAt: number; status: PortalSchemaStatus };
type CoalescingOptions = {
  now?: () => number;
  cacheTtlMs?: number;
};

let successfulV2Cache = new WeakMap<object, ReadyCacheEntry>();
let inFlightV2Ensures = new WeakMap<object, Promise<PortalSchemaStatus>>();

function safeNow(options: CoalescingOptions = {}): number {
  const value = options.now?.() ?? Date.now();
  return Number.isFinite(value) ? Math.trunc(value) : Date.now();
}

export function coalescePortalSchemaV2Ensure(
  database: object,
  runner: () => Promise<PortalSchemaStatus>,
  options: CoalescingOptions = {},
): Promise<PortalSchemaStatus> {
  const now = safeNow(options);
  const cached = successfulV2Cache.get(database);
  if (cached && cached.expiresAt > now) return Promise.resolve({ ...cached.status, verifiedAt: now });
  const inFlight = inFlightV2Ensures.get(database);
  if (inFlight) return inFlight;

  const promise = runner().then((schema) => {
    if (schema.state === "ready") {
      const ttl = Math.max(0, Math.min(Math.trunc(options.cacheTtlMs ?? 5_000), 60_000));
      successfulV2Cache.set(database, { expiresAt: safeNow(options) + ttl, status: schema });
    }
    return schema;
  });
  inFlightV2Ensures.set(database, promise);
  void promise.finally(() => {
    if (inFlightV2Ensures.get(database) === promise) inFlightV2Ensures.delete(database);
  });
  return promise;
}

export function clearPortalSchemaV2CacheForTests(): void {
  successfulV2Cache = new WeakMap();
  inFlightV2Ensures = new WeakMap();
}

export function normalizePortalRestoreStageSql(value: unknown): string {
  return String(value ?? "")
    .replaceAll('"', "")
    .replaceAll("`", "")
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replace(/\bif\s+not\s+exists\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function incompatible(status: PortalSchemaStatus, reasons: string[]): PortalSchemaStatus {
  return {
    ...status,
    state: "incompatible",
    compatibleDrift: [],
    incompatibleDrift: [...new Set([...status.incompatibleDrift, ...reasons])].sort(),
    errorCode: "schema_drift_incompatible",
  };
}

async function verifyRestoreStageSchema(
  env: MigrationEnv,
  status: PortalSchemaStatus,
): Promise<PortalSchemaStatus> {
  if (status.state !== "ready" || !env.DB) return status;
  const reasons: string[] = [];
  try {
    const tableInfo = await env.DB.prepare("PRAGMA table_info('portal_backup_restore_stages')").all<TableInfoRow>();
    const actualColumns = tableInfo.results ?? [];
    if (actualColumns.length !== portalRestoreStageTable.columns.length) {
      reasons.push("table:portal_backup_restore_stages:column_count");
    }
    for (const required of portalRestoreStageTable.columns) {
      const actual = actualColumns.find((column) => String(column.name) === required.name);
      if (!actual) {
        reasons.push(`table:portal_backup_restore_stages:missing_column:${required.name}`);
        continue;
      }
      if (String(actual.type).trim().toUpperCase().split(/\s+/)[0] !== required.type) {
        reasons.push(`table:portal_backup_restore_stages:type:${required.name}`);
      }
      if ((Number(actual.notnull) === 1) !== required.notNull) {
        reasons.push(`table:portal_backup_restore_stages:not_null:${required.name}`);
      }
      if ((Number(actual.pk) > 0) !== required.primaryKey) {
        reasons.push(`table:portal_backup_restore_stages:primary_key:${required.name}`);
      }
    }

    const objects = await env.DB.prepare(
      "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE tbl_name = ? OR name = ? ORDER BY name",
    ).bind("portal_backup_restore_stages", "portal_backup_restore_stages").all<SchemaObjectRow>();
    const rows = objects.results ?? [];
    const table = rows.find((row) => row.type === "table" && row.name === portalRestoreStageTable.name);
    const index = rows.find((row) => row.type === "index" && row.name === portalRestoreStageIndex.name);
    if (!table) reasons.push("table:portal_backup_restore_stages:missing");
    if (!index) reasons.push("index:portal_backup_restore_stages_status_idx:missing");

    const tableSql = normalizePortalRestoreStageSql(table?.sql);
    if (tableSql && (/\b(?:check|references|foreign key)\b/.test(tableSql)
        || (tableSql.match(/\bunique\b/g) ?? []).length > 0)) {
      reasons.push("table:portal_backup_restore_stages:unexpected_constraint");
    }
    if (index && normalizePortalRestoreStageSql(index.sql) !== normalizePortalRestoreStageSql(portalRestoreStageIndex.sql)) {
      reasons.push("index:portal_backup_restore_stages_status_idx:definition");
    }
    for (const row of rows) {
      if (row.type === "trigger") reasons.push(`trigger:portal_backup_restore_stages:unexpected:${row.name}`);
      if (row.type === "index"
          && !String(row.name).startsWith("sqlite_")
          && row.name !== portalRestoreStageIndex.name) {
        reasons.push(`index:portal_backup_restore_stages:unexpected:${row.name}`);
      }
    }
  } catch {
    return {
      ...status,
      state: "failed",
      errorCode: "schema_migration_failed",
    };
  }
  return reasons.length ? incompatible(status, reasons) : status;
}

export async function inspectPortalSchemaV2(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  const status = await inspectPortalSchemaWithRegistry(env, portalMigrationsV2, options);
  return verifyRestoreStageSchema(env, status);
}

export function ensurePortalSchemaV2(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  if (!env.DB) {
    return ensurePortalSchemaWithRegistry(env, portalMigrationsV2, options)
      .then((status) => verifyRestoreStageSchema(env, status));
  }
  return coalescePortalSchemaV2Ensure(
    env.DB as unknown as object,
    async () => {
      const status = await ensurePortalSchemaWithRegistry(env, portalMigrationsV2, options);
      return verifyRestoreStageSchema(env, status);
    },
    options,
  );
}
