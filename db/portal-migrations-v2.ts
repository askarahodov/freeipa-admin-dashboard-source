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

function normalizedSql(value: unknown): string {
  return String(value ?? "")
    .replaceAll('"', "")
    .replaceAll("`", "")
    .replaceAll("[", "")
    .replaceAll("]", "")
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

    const tableSql = normalizedSql(table?.sql);
    if (tableSql && (/\b(?:check|references|foreign key)\b/.test(tableSql)
        || (tableSql.match(/\bunique\b/g) ?? []).length > 0)) {
      reasons.push("table:portal_backup_restore_stages:unexpected_constraint");
    }
    if (index && normalizedSql(index.sql) !== normalizedSql(portalRestoreStageIndex.sql)) {
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

export async function ensurePortalSchemaV2(
  env: MigrationEnv,
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  const status = await ensurePortalSchemaWithRegistry(env, portalMigrationsV2, options);
  return verifyRestoreStageSchema(env, status);
}
