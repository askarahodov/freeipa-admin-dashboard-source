import {
  ensurePortalSchemaWithRegistry,
  inspectPortalSchemaWithRegistry,
  type PortalMigration,
  type PortalSchemaStatus,
} from "./portal-migrations.ts";
import {
  portalMigrationV3SecondaryStatements,
  portalMigrationV3Statements,
  portalMigrationV3TableStatements,
} from "./portal-migration-v3.ts";
import {
  portalMaintenanceStateIndex,
  portalMaintenanceStateTable,
} from "./portal-maintenance-schema.ts";
import { portalMigrationsV2 } from "./portal-migrations-v2.ts";

const maintenanceMigration: PortalMigration = {
  version: 3,
  name: "maintenance-mode-foundation",
  statements: portalMigrationV3Statements,
  tableStatements: portalMigrationV3TableStatements,
  secondaryStatements: portalMigrationV3SecondaryStatements,
  snapshot: {
    tables: [portalMaintenanceStateTable],
    indexes: [portalMaintenanceStateIndex],
    triggers: [],
  },
  checksum: async () => {
    const material = JSON.stringify({
      version: 3,
      name: "maintenance-mode-foundation",
      statements: portalMigrationV3Statements,
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
};

export const portalMigrationsV3 = Object.freeze([
  ...portalMigrationsV2,
  maintenanceMigration,
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

let successfulV3Cache = new WeakMap<object, ReadyCacheEntry>();
let inFlightV3Ensures = new WeakMap<object, Promise<PortalSchemaStatus>>();

function safeNow(options: CoalescingOptions = {}): number {
  const value = options.now?.() ?? Date.now();
  return Number.isFinite(value) ? Math.trunc(value) : Date.now();
}

export function coalescePortalSchemaV3Ensure(
  database: object,
  runner: () => Promise<PortalSchemaStatus>,
  options: CoalescingOptions = {},
): Promise<PortalSchemaStatus> {
  const now = safeNow(options);
  const cached = successfulV3Cache.get(database);
  if (cached && cached.expiresAt > now) return Promise.resolve({ ...cached.status, verifiedAt: now });
  const inFlight = inFlightV3Ensures.get(database);
  if (inFlight) return inFlight;

  const promise = runner().then((schema) => {
    if (schema.state === "ready") {
      const ttl = Math.max(0, Math.min(Math.trunc(options.cacheTtlMs ?? 5_000), 60_000));
      successfulV3Cache.set(database, { expiresAt: safeNow(options) + ttl, status: schema });
    }
    return schema;
  });
  inFlightV3Ensures.set(database, promise);
  void promise.finally(() => {
    if (inFlightV3Ensures.get(database) === promise) inFlightV3Ensures.delete(database);
  });
  return promise;
}

export function clearPortalSchemaV3CacheForTests(): void {
  successfulV3Cache = new WeakMap();
  inFlightV3Ensures = new WeakMap();
}

export function normalizePortalMaintenanceSql(value: unknown): string {
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

async function verifyMaintenanceSchema(
  env: MigrationEnv,
  status: PortalSchemaStatus,
): Promise<PortalSchemaStatus> {
  if (status.state !== "ready" || !env.DB) return status;
  const reasons: string[] = [];
  try {
    const tableInfo = await env.DB.prepare("PRAGMA table_info('portal_maintenance_state')").all<TableInfoRow>();
    const actualColumns = tableInfo.results ?? [];
    if (actualColumns.length !== portalMaintenanceStateTable.columns.length) {
      reasons.push("table:portal_maintenance_state:column_count");
    }
    for (const required of portalMaintenanceStateTable.columns) {
      const actual = actualColumns.find((column) => String(column.name) === required.name);
      if (!actual) {
        reasons.push(`table:portal_maintenance_state:missing_column:${required.name}`);
        continue;
      }
      if (String(actual.type).trim().toUpperCase().split(/\s+/)[0] !== required.type) {
        reasons.push(`table:portal_maintenance_state:type:${required.name}`);
      }
      if ((Number(actual.notnull) === 1) !== required.notNull) {
        reasons.push(`table:portal_maintenance_state:not_null:${required.name}`);
      }
      if ((Number(actual.pk) > 0) !== required.primaryKey) {
        reasons.push(`table:portal_maintenance_state:primary_key:${required.name}`);
      }
    }

    const objects = await env.DB.prepare(
      "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE tbl_name = ? OR name = ? ORDER BY name",
    ).bind("portal_maintenance_state", "portal_maintenance_state").all<SchemaObjectRow>();
    const rows = objects.results ?? [];
    const table = rows.find((row) => row.type === "table" && row.name === portalMaintenanceStateTable.name);
    const index = rows.find((row) => row.type === "index" && row.name === portalMaintenanceStateIndex.name);
    if (!table) reasons.push("table:portal_maintenance_state:missing");
    if (!index) reasons.push("index:portal_maintenance_state_state_idx:missing");

    const tableSql = normalizePortalMaintenanceSql(table?.sql);
    if (tableSql && (/\b(?:check|references|foreign key)\b/.test(tableSql)
        || (tableSql.match(/\bunique\b/g) ?? []).length > 0)) {
      reasons.push("table:portal_maintenance_state:unexpected_constraint");
    }
    if (index && normalizePortalMaintenanceSql(index.sql) !== normalizePortalMaintenanceSql(portalMaintenanceStateIndex.sql)) {
      reasons.push("index:portal_maintenance_state_state_idx:definition");
    }
    for (const row of rows) {
      if (row.type === "trigger") reasons.push(`trigger:portal_maintenance_state:unexpected:${row.name}`);
      if (row.type === "index"
          && !String(row.name).startsWith("sqlite_")
          && row.name !== portalMaintenanceStateIndex.name) {
        reasons.push(`index:portal_maintenance_state:unexpected:${row.name}`);
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

export async function inspectPortalSchemaV3(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  const status = await inspectPortalSchemaWithRegistry(env, portalMigrationsV3, options);
  return verifyMaintenanceSchema(env, status);
}

export function ensurePortalSchemaV3(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  if (!env.DB) {
    return ensurePortalSchemaWithRegistry(env, portalMigrationsV3, options)
      .then((status) => verifyMaintenanceSchema(env, status));
  }
  return coalescePortalSchemaV3Ensure(
    env.DB as unknown as object,
    async () => {
      const status = await ensurePortalSchemaWithRegistry(env, portalMigrationsV3, options);
      return verifyMaintenanceSchema(env, status);
    },
    options,
  );
}
