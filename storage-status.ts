import { inspectPortalSchema, type PortalSchemaStatus } from "./db/portal-migrations-hardened.ts";
import { portalMaintenanceStateTable } from "./db/portal-maintenance-schema.ts";
import { portalRestoreStageTable } from "./db/portal-restore-stage-schema.ts";
import { portalSchemaTables } from "./db/portal-schema.ts";
import { storageEncryptionSelfTest } from "./storage-encryption-self-test.ts";

export type StorageOverallState = "healthy" | "degraded" | "unavailable";
export type StorageSchemaState = PortalSchemaStatus["state"] | "unknown";
export type StorageDomainName =
  | "settings"
  | "operations"
  | "catalog"
  | "approvals"
  | "identity"
  | "audit"
  | "maintenance"
  | "restore"
  | "other";

export type StorageDomainStatus = {
  name: StorageDomainName;
  expectedTables: number;
  presentTables: number;
  records: number;
  code: "storage_domain_counted" | "storage_domain_partial";
};

export type StorageStatusReport = {
  contractVersion: "1";
  generatedAt: number;
  state: StorageOverallState;
  database: {
    available: boolean;
    pageCount: number | null;
    pageSize: number | null;
    logicalBytes: number | null;
    code: "storage_size_available" | "storage_size_unavailable" | "storage_database_unavailable" | "storage_inventory_unavailable";
  };
  schema: {
    state: StorageSchemaState;
    currentVersion: number | null;
    latestVersion: number | null;
    appliedVersions: number[];
    pendingVersions: number[];
    compatibleDriftCount: number;
    incompatibleDriftCount: number;
    errorCode: string | null;
  };
  domains: StorageDomainStatus[];
  encryption: {
    state: "ready" | "unavailable";
    code: "storage_encryption_ready" | "storage_encryption_unavailable";
  };
  lifecycle: {
    lastBackupAt: number | null;
    lastRestoreAt: number | null;
    lastCleanupAt: null;
    code: "storage_lifecycle_available" | "storage_lifecycle_unavailable";
  };
};

type StorageStatusEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
};

type StorageQuery = {
  all<T extends Record<string, unknown>>(sql: string): Promise<T[]>;
  first<T extends Record<string, unknown>>(sql: string): Promise<T | null>;
};

type StorageStatusDependencies = {
  query?: StorageQuery;
  inspectSchema?: (env: StorageStatusEnv) => Promise<PortalSchemaStatus>;
  encryptionSelfTest?: (value: unknown) => Promise<boolean>;
  now?: () => number;
};

type CanonicalTable = { name: string; domain: StorageDomainName };

const contractVersion = "1" as const;
const domainOrder: readonly StorageDomainName[] = [
  "settings",
  "operations",
  "catalog",
  "approvals",
  "identity",
  "audit",
  "maintenance",
  "restore",
  "other",
];

function domainForTable(name: string): StorageDomainName {
  if (name === portalMaintenanceStateTable.name) return "maintenance";
  if (name === portalRestoreStageTable.name) return "restore";
  if (name === "portal_audit_events") return "audit";
  if (name === "approval_policy_sets" || name === "operation_approvals" || name === "operation_approval_decisions") return "approvals";
  if (name.startsWith("portal_settings_") || name === "app_settings") return "settings";
  if (name.startsWith("xyops_catalog_") || name === "catalog_visibility_policies" || name === "process_presentation_sets") return "catalog";
  if (name === "portal_users" || name === "portal_sessions" || name.startsWith("portal_role") || name.startsWith("portal_rbac") || name.startsWith("portal_user_role")) return "identity";
  if (name.startsWith("operation_")) return "operations";
  return "other";
}

const canonicalTables: readonly CanonicalTable[] = [...new Set([
  ...portalSchemaTables.map((table) => table.name),
  portalMaintenanceStateTable.name,
  portalRestoreStageTable.name,
])]
  .sort((left, right) => left.localeCompare(right))
  .map((name) => ({ name, domain: domainForTable(name) }));

function emptyDomains(
  code: StorageDomainStatus["code"] = "storage_domain_partial",
): StorageDomainStatus[] {
  return domainOrder.map((name) => ({
    name,
    expectedTables: canonicalTables.filter((table) => table.domain === name).length,
    presentTables: 0,
    records: 0,
    code,
  }));
}

function safeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeVersionList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(safeInteger).filter((item): item is number => item !== null))]
    .sort((left, right) => left - right)
    .slice(0, 64);
}

function safeCount(value: unknown): number {
  const count = safeInteger(value);
  return count === null ? 0 : Math.min(count, 100_000);
}

const safeSchemaCodes = new Set([
  "schema_database_unavailable",
  "schema_busy",
  "schema_incompatible",
  "schema_migration_failed",
  "schema_journal_gap",
  "schema_incompatible_drift",
  "schema_missing",
  "schema_unavailable",
]);

function safeSchemaErrorCode(schema: PortalSchemaStatus): string | null {
  if (schema.state === "ready") return null;
  return schema.errorCode && safeSchemaCodes.has(schema.errorCode) ? schema.errorCode : "schema_unready";
}

function publicSchema(schema: PortalSchemaStatus): StorageStatusReport["schema"] {
  return {
    state: schema.state,
    currentVersion: safeInteger(schema.currentVersion),
    latestVersion: safeInteger(schema.latestVersion),
    appliedVersions: safeVersionList(schema.appliedVersions),
    pendingVersions: safeVersionList(schema.pendingVersions),
    compatibleDriftCount: safeCount(schema.compatibleDrift?.length),
    incompatibleDriftCount: safeCount(schema.incompatibleDrift?.length),
    errorCode: safeSchemaErrorCode(schema),
  };
}

function unknownSchema(errorCode: string): StorageStatusReport["schema"] {
  return {
    state: "unknown",
    currentVersion: null,
    latestVersion: null,
    appliedVersions: [],
    pendingVersions: [],
    compatibleDriftCount: 0,
    incompatibleDriftCount: 0,
    errorCode,
  };
}

function quoteCanonicalIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function defaultQuery(env: StorageStatusEnv): StorageQuery {
  const db = env.DB!;
  return {
    async all<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
      const result = await db.prepare(sql).all<T>();
      return result.results ?? [];
    },
    async first<T extends Record<string, unknown>>(sql: string): Promise<T | null> {
      return await db.prepare(sql).first<T>();
    },
  };
}

function unavailableReport(
  generatedAt: number,
  code: "storage_database_unavailable" | "storage_inventory_unavailable",
): StorageStatusReport {
  return {
    contractVersion,
    generatedAt,
    state: "unavailable",
    database: { available: false, pageCount: null, pageSize: null, logicalBytes: null, code },
    schema: unknownSchema(code === "storage_database_unavailable" ? "schema_database_unavailable" : "schema_unavailable"),
    domains: emptyDomains(),
    encryption: { state: "unavailable", code: "storage_encryption_unavailable" },
    lifecycle: { lastBackupAt: null, lastRestoreAt: null, lastCleanupAt: null, code: "storage_lifecycle_unavailable" },
  };
}

async function readDatabaseSize(query: StorageQuery): Promise<StorageStatusReport["database"]> {
  try {
    const pageCountRow = await query.first<{ page_count?: unknown }>("PRAGMA page_count");
    const pageSizeRow = await query.first<{ page_size?: unknown }>("PRAGMA page_size");
    const pageCount = safeInteger(pageCountRow?.page_count);
    const pageSize = safeInteger(pageSizeRow?.page_size);
    const logicalBytes = pageCount !== null
      && pageSize !== null
      && pageSize > 0
      && pageCount <= Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? pageCount * pageSize
      : null;
    if (pageCount === null || pageSize === null || logicalBytes === null) {
      return { available: true, pageCount, pageSize, logicalBytes: null, code: "storage_size_unavailable" };
    }
    return { available: true, pageCount, pageSize, logicalBytes, code: "storage_size_available" };
  } catch {
    return { available: true, pageCount: null, pageSize: null, logicalBytes: null, code: "storage_size_unavailable" };
  }
}

async function readLifecycle(
  query: StorageQuery,
  presentTables: ReadonlySet<string>,
): Promise<StorageStatusReport["lifecycle"]> {
  if (!presentTables.has("portal_audit_events")) {
    return { lastBackupAt: null, lastRestoreAt: null, lastCleanupAt: null, code: "storage_lifecycle_unavailable" };
  }
  try {
    const row = await query.first<{ last_backup_at?: unknown; last_restore_at?: unknown }>(`
      SELECT
        MAX(CASE WHEN action LIKE 'backup.%export%.completed' AND outcome = 'success' THEN created_at END) AS last_backup_at,
        MAX(CASE WHEN action LIKE 'backup.restore.%' AND outcome = 'success' THEN created_at END) AS last_restore_at
      FROM portal_audit_events
    `);
    return {
      lastBackupAt: safeInteger(row?.last_backup_at),
      lastRestoreAt: safeInteger(row?.last_restore_at),
      lastCleanupAt: null,
      code: "storage_lifecycle_available",
    };
  } catch {
    return { lastBackupAt: null, lastRestoreAt: null, lastCleanupAt: null, code: "storage_lifecycle_unavailable" };
  }
}

async function readDomains(
  query: StorageQuery,
  presentTables: ReadonlySet<string>,
): Promise<StorageDomainStatus[]> {
  const domains = emptyDomains("storage_domain_counted");
  const byName = new Map(domains.map((domain) => [domain.name, domain]));
  for (const table of canonicalTables) {
    if (!presentTables.has(table.name)) continue;
    const domain = byName.get(table.domain)!;
    domain.presentTables += 1;
    try {
      const row = await query.first<{ count?: unknown }>(
        `SELECT COUNT(*) AS count FROM ${quoteCanonicalIdentifier(table.name)}`,
      );
      const count = safeInteger(row?.count);
      if (count === null) throw new Error("invalid_count");
      domain.records += count;
    } catch {
      domain.code = "storage_domain_partial";
    }
  }
  for (const domain of domains) {
    if (domain.presentTables !== domain.expectedTables) domain.code = "storage_domain_partial";
  }
  return domains;
}

export async function inspectStorageStatus(
  env: StorageStatusEnv,
  dependencies: StorageStatusDependencies = {},
): Promise<StorageStatusReport> {
  const generatedAt = safeInteger((dependencies.now ?? Date.now)()) ?? 0;
  if (!env.DB) return unavailableReport(generatedAt, "storage_database_unavailable");
  if (!dependencies.query && typeof env.DB.prepare !== "function") {
    return unavailableReport(generatedAt, "storage_database_unavailable");
  }

  const query = dependencies.query ?? defaultQuery(env);
  let presentTables: Set<string>;
  try {
    const rows = await query.all<{ name?: unknown }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    const canonicalNames = new Set(canonicalTables.map((table) => table.name));
    presentTables = new Set(
      rows.map((row) => String(row.name ?? "")).filter((name) => canonicalNames.has(name)),
    );
  } catch {
    return unavailableReport(generatedAt, "storage_inventory_unavailable");
  }

  const [database, schema, domains, encryptionReady, lifecycle] = await Promise.all([
    readDatabaseSize(query),
    (async () => {
      try {
        return publicSchema(await (dependencies.inspectSchema ?? inspectPortalSchema)(env));
      } catch {
        return unknownSchema("schema_unavailable");
      }
    })(),
    readDomains(query, presentTables),
    (dependencies.encryptionSelfTest ?? storageEncryptionSelfTest)(env.CONFIG_ENCRYPTION_KEY).catch(() => false),
    readLifecycle(query, presentTables),
  ]);

  const encryption: StorageStatusReport["encryption"] = encryptionReady
    ? { state: "ready", code: "storage_encryption_ready" }
    : { state: "unavailable", code: "storage_encryption_unavailable" };
  const healthy = database.code === "storage_size_available"
    && schema.state === "ready"
    && encryption.state === "ready"
    && lifecycle.code === "storage_lifecycle_available"
    && domains.every((domain) => domain.code === "storage_domain_counted");

  return {
    contractVersion,
    generatedAt,
    state: healthy ? "healthy" : "degraded",
    database,
    schema,
    domains,
    encryption,
    lifecycle,
  };
}