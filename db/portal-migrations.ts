import {
  portalBaselineStatements,
  portalSchemaIndexes,
  portalSchemaTables,
  portalSchemaTriggers,
  type PortalSchemaColumn,
} from "./portal-schema";

export type PortalSchemaState = "ready" | "busy" | "unavailable" | "incompatible" | "failed";

export type PortalSchemaStatus = {
  state: PortalSchemaState;
  currentVersion: number;
  latestVersion: number;
  appliedVersions: number[];
  pendingVersions: number[];
  compatibleDrift: string[];
  incompatibleDrift: string[];
  errorCode: string;
  verifiedAt: number;
};

type MigrationEnv = { DB?: D1Database };
type MigrationRow = { version: number; name: string; checksum: string; applied_at: number; execution_ms: number };
type SchemaObjectRow = { name: string; type: string; tbl_name: string };
type TableInfoRow = { name: string; type: string; notnull: number; pk: number };

type MigrationOptions = {
  now?: () => number;
  maxLockAttempts?: number;
  lockTtlMs?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type PortalMigration = {
  version: number;
  name: string;
  statements: readonly string[];
  checksum: () => Promise<string>;
};

const latestVersion = 1;
const migrationTableSql = portalSchemaTables.find((table) => table.name === "portal_schema_migrations")!.sql;
const migrationLockSql = portalSchemaTables.find((table) => table.name === "portal_schema_lock")!.sql;
const successfulCache = new WeakMap<object, { expiresAt: number; status: PortalSchemaStatus }>();

function safeNow(options?: MigrationOptions): number {
  const value = options?.now?.() ?? Date.now();
  return Number.isFinite(value) ? Math.trunc(value) : Date.now();
}

function resultChanges(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const result = value as { meta?: { changes?: number }; changes?: number };
  return Number(result.meta?.changes ?? result.changes ?? 0);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checksum(version: number, name: string, statements: readonly string[]): Promise<string> {
  const material = JSON.stringify({ version, name, statements });
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)));
}

const baseline: PortalMigration = {
  version: 1,
  name: "canonical-runtime-baseline",
  statements: portalBaselineStatements,
  checksum: () => checksum(1, "canonical-runtime-baseline", portalBaselineStatements),
};

export const portalMigrations = [baseline] as const satisfies readonly PortalMigration[];

function status(
  state: PortalSchemaState,
  values: Partial<Omit<PortalSchemaStatus, "state" | "latestVersion" | "verifiedAt">> = {},
  verifiedAt = Date.now(),
): PortalSchemaStatus {
  return {
    state,
    currentVersion: values.currentVersion ?? 0,
    latestVersion,
    appliedVersions: [...(values.appliedVersions ?? [])],
    pendingVersions: [...(values.pendingVersions ?? portalMigrations.map((migration) => migration.version))],
    compatibleDrift: [...(values.compatibleDrift ?? [])].sort(),
    incompatibleDrift: [...(values.incompatibleDrift ?? [])].sort(),
    errorCode: values.errorCode ?? "",
    verifiedAt,
  };
}

function normalizedType(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().split(/\s+/)[0] ?? "";
}

function columnMismatch(required: PortalSchemaColumn, actual: TableInfoRow): string | null {
  if (normalizedType(actual.type) !== required.type) return "type";
  if ((Number(actual.notnull) === 1) !== required.notNull) return "not_null";
  if ((Number(actual.pk) > 0) !== required.primaryKey) return "primary_key";
  return null;
}

function ignoredObject(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("_cf_") || name === "d1_migrations";
}

async function journalRows(db: D1Database): Promise<MigrationRow[]> {
  const result = await db.prepare("SELECT version, name, checksum, applied_at, execution_ms FROM portal_schema_migrations ORDER BY version ASC")
    .all<MigrationRow>();
  return (result.results ?? []).map((row) => ({
    version: Number(row.version),
    name: String(row.name ?? ""),
    checksum: String(row.checksum ?? ""),
    applied_at: Number(row.applied_at ?? 0),
    execution_ms: Number(row.execution_ms ?? 0),
  }));
}

async function schemaObjects(db: D1Database): Promise<SchemaObjectRow[]> {
  const result = await db.prepare("SELECT name, type, tbl_name FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<SchemaObjectRow>();
  return (result.results ?? []).map((row) => ({ name: String(row.name ?? ""), type: String(row.type ?? ""), tbl_name: String(row.tbl_name ?? "") }));
}

async function inspectStructure(db: D1Database): Promise<{ compatible: string[]; incompatible: string[] }> {
  const compatible = new Set<string>();
  const incompatible = new Set<string>();
  const objects = await schemaObjects(db);
  const tables = new Map(objects.filter((item) => item.type === "table").map((item) => [item.name, item]));
  const indexes = new Map(objects.filter((item) => item.type === "index").map((item) => [item.name, item]));
  const triggers = new Map(objects.filter((item) => item.type === "trigger").map((item) => [item.name, item]));
  const requiredTableNames = new Set(portalSchemaTables.map((table) => table.name));
  const requiredIndexNames = new Set(portalSchemaIndexes.map((index) => index.name));
  const requiredTriggerNames = new Set(portalSchemaTriggers.map((trigger) => trigger.name));

  for (const table of portalSchemaTables) {
    if (!tables.has(table.name)) {
      incompatible.add(`table:${table.name}:missing`);
      continue;
    }
    const info = await db.prepare(`PRAGMA table_info("${table.name}")`).all<TableInfoRow>();
    const actualColumns = new Map((info.results ?? []).map((column) => [String(column.name), column]));
    const requiredColumns = new Set(table.columns.map((column) => column.name));
    for (const required of table.columns) {
      const actual = actualColumns.get(required.name);
      if (!actual) {
        incompatible.add(`column:${table.name}.${required.name}:missing`);
        continue;
      }
      const mismatch = columnMismatch(required, actual);
      if (mismatch) incompatible.add(`column:${table.name}.${required.name}:${mismatch}`);
    }
    for (const actual of actualColumns.keys()) {
      if (!requiredColumns.has(actual)) compatible.add(`column:${table.name}.${actual}:extra`);
    }
  }

  for (const index of portalSchemaIndexes) {
    const actual = indexes.get(index.name);
    if (!actual) incompatible.add(`index:${index.name}:missing`);
    else if (actual.tbl_name !== index.table) incompatible.add(`index:${index.name}:wrong_table`);
  }
  for (const trigger of portalSchemaTriggers) {
    const actual = triggers.get(trigger.name);
    if (!actual) incompatible.add(`trigger:${trigger.name}:missing`);
    else if (actual.tbl_name !== trigger.table) incompatible.add(`trigger:${trigger.name}:wrong_table`);
  }

  for (const table of tables.keys()) {
    if (!requiredTableNames.has(table) && !ignoredObject(table)) compatible.add(`table:${table}:extra`);
  }
  for (const index of indexes.keys()) {
    if (!requiredIndexNames.has(index) && !ignoredObject(index)) compatible.add(`index:${index}:extra`);
  }
  for (const trigger of triggers.keys()) {
    if (!requiredTriggerNames.has(trigger) && !ignoredObject(trigger)) compatible.add(`trigger:${trigger}:extra`);
  }

  return { compatible: [...compatible].sort(), incompatible: [...incompatible].sort() };
}

async function validateJournal(rows: MigrationRow[], verifiedAt: number): Promise<PortalSchemaStatus | null> {
  const appliedVersions = rows.map((row) => row.version).sort((left, right) => left - right);
  const currentVersion = appliedVersions.at(-1) ?? 0;
  const pendingVersions = portalMigrations.map((migration) => migration.version).filter((version) => !appliedVersions.includes(version));
  if (currentVersion > latestVersion || rows.some((row) => !portalMigrations.some((migration) => migration.version === row.version))) {
    return status("failed", { currentVersion, appliedVersions, pendingVersions, errorCode: "schema_future_version" }, verifiedAt);
  }
  for (const row of rows) {
    const migration = portalMigrations.find((item) => item.version === row.version);
    if (!migration || row.name !== migration.name || row.checksum !== await migration.checksum()) {
      return status("failed", { currentVersion, appliedVersions, pendingVersions, errorCode: "schema_checksum_mismatch" }, verifiedAt);
    }
  }
  return null;
}

export async function inspectPortalSchema(env: MigrationEnv, options: MigrationOptions = {}): Promise<PortalSchemaStatus> {
  const verifiedAt = safeNow(options);
  if (!env.DB) return status("unavailable", { errorCode: "schema_database_unavailable" }, verifiedAt);
  try {
    const rows = await journalRows(env.DB);
    const invalidJournal = await validateJournal(rows, verifiedAt);
    if (invalidJournal) return invalidJournal;
    const appliedVersions = rows.map((row) => row.version).sort((left, right) => left - right);
    const currentVersion = appliedVersions.at(-1) ?? 0;
    const pendingVersions = portalMigrations.map((migration) => migration.version).filter((version) => !appliedVersions.includes(version));
    const drift = await inspectStructure(env.DB);
    if (drift.incompatible.length) {
      return status("incompatible", {
        currentVersion, appliedVersions, pendingVersions, compatibleDrift: drift.compatible,
        incompatibleDrift: drift.incompatible, errorCode: "schema_incompatible_drift",
      }, verifiedAt);
    }
    return status("ready", { currentVersion, appliedVersions, pendingVersions, compatibleDrift: drift.compatible }, verifiedAt);
  } catch {
    return status("failed", { errorCode: "schema_migration_failed" }, verifiedAt);
  }
}

async function ensureInfrastructure(db: D1Database): Promise<void> {
  await db.prepare(migrationTableSql).run();
  await db.prepare(migrationLockSql).run();
}

async function acquireLock(db: D1Database, owner: string, options: MigrationOptions): Promise<boolean> {
  const attempts = Math.max(1, Math.min(Math.trunc(options.maxLockAttempts ?? 5), 20));
  const ttl = Math.max(1_000, Math.min(Math.trunc(options.lockTtlMs ?? 60_000), 10 * 60_000));
  const delay = Math.max(0, Math.min(Math.trunc(options.retryDelayMs ?? 50), 1_000));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const now = safeNow(options);
    await db.prepare("DELETE FROM portal_schema_lock WHERE id = ? AND acquired_at < ?").bind("main", now - ttl).run();
    const inserted = await db.prepare("INSERT OR IGNORE INTO portal_schema_lock (id, owner, acquired_at) VALUES (?, ?, ?)")
      .bind("main", owner, now).run();
    if (resultChanges(inserted) === 1) return true;
    if (attempt + 1 < attempts && delay > 0) await sleep(delay);
  }
  return false;
}

async function releaseLock(db: D1Database, owner: string): Promise<void> {
  await db.prepare("DELETE FROM portal_schema_lock WHERE id = ? AND owner = ?").bind("main", owner).run();
}

async function applyMigration(db: D1Database, migration: PortalMigration, options: MigrationOptions): Promise<PortalSchemaStatus | null> {
  const startedAt = safeNow(options);
  await db.batch(migration.statements.map((statement) => db.prepare(statement)));
  const drift = await inspectStructure(db);
  const rows = await journalRows(db);
  const appliedVersions = rows.map((row) => row.version).sort((left, right) => left - right);
  if (drift.incompatible.length) {
    return status("incompatible", {
      currentVersion: appliedVersions.at(-1) ?? 0,
      appliedVersions,
      pendingVersions: portalMigrations.map((item) => item.version).filter((version) => !appliedVersions.includes(version)),
      compatibleDrift: drift.compatible,
      incompatibleDrift: drift.incompatible,
      errorCode: "schema_incompatible_drift",
    }, safeNow(options));
  }
  const completedAt = safeNow(options);
  await db.prepare("INSERT INTO portal_schema_migrations (version, name, checksum, applied_at, execution_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(migration.version, migration.name, await migration.checksum(), completedAt, Math.max(0, completedAt - startedAt)).run();
  return null;
}

export async function ensurePortalSchema(env: MigrationEnv, options: MigrationOptions = {}): Promise<PortalSchemaStatus> {
  const verifiedAt = safeNow(options);
  if (!env.DB) return status("unavailable", { errorCode: "schema_database_unavailable" }, verifiedAt);
  const dbObject = env.DB as unknown as object;
  const cached = successfulCache.get(dbObject);
  if (cached && cached.expiresAt > verifiedAt) return { ...cached.status, verifiedAt };

  const owner = crypto.randomUUID();
  let acquired = false;
  try {
    await ensureInfrastructure(env.DB);
    acquired = await acquireLock(env.DB, owner, options);
    if (!acquired) return status("busy", { errorCode: "schema_migration_busy" }, safeNow(options));

    const rows = await journalRows(env.DB);
    const invalidJournal = await validateJournal(rows, safeNow(options));
    if (invalidJournal) return invalidJournal;
    const applied = new Set(rows.map((row) => row.version));
    for (const migration of portalMigrations) {
      if (applied.has(migration.version)) continue;
      const failure = await applyMigration(env.DB, migration, options);
      if (failure) return failure;
    }

    const finalStatus = await inspectPortalSchema(env, options);
    if (finalStatus.state === "ready") {
      const ttl = Math.max(0, Math.min(Math.trunc(options.cacheTtlMs ?? 5_000), 60_000));
      successfulCache.set(dbObject, { expiresAt: safeNow(options) + ttl, status: finalStatus });
    }
    return finalStatus;
  } catch {
    return status("failed", { errorCode: "schema_migration_failed" }, safeNow(options));
  } finally {
    if (acquired) await releaseLock(env.DB, owner).catch(() => {});
  }
}

export function publicPortalSchemaStatus(value: PortalSchemaStatus) {
  return {
    state: value.state,
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    appliedVersions: [...value.appliedVersions],
    pendingVersions: [...value.pendingVersions],
    compatibleDrift: [...value.compatibleDrift],
    incompatibleDrift: [...value.incompatibleDrift],
    errorCode: value.errorCode,
    verifiedAt: value.verifiedAt,
  };
}

export function clearPortalSchemaCacheForTests(): void {
  // WeakMap cannot be cleared; replacing entries is unnecessary because tests use a fresh DB object.
}
