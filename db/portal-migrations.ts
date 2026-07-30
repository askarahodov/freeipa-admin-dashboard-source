import {
  portalBaselineStatements,
  portalSchemaIndexes,
  portalSchemaTables,
  portalSchemaTriggers,
  type PortalSchemaColumn,
} from "./portal-schema.ts";

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
type SchemaObjectRow = { name: string; type: string; tbl_name: string; sql: string | null };
type TableInfoRow = { name: string; type: string; notnull: number; pk: number };
type IndexListRow = { seq: number; name: string; unique: number; origin: string; partial: number };
type IndexXInfoRow = { seqno: number; cid: number; name: string | null; desc: number; key: number };
type IndexColumn = { name: string; descending: boolean };

type MigrationOptions = {
  now?: () => number;
  maxLockAttempts?: number;
  lockTtlMs?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type InspectOptions = {
  secondary?: boolean;
  extras?: boolean;
};

export type PortalMigration = {
  version: number;
  name: string;
  statements: readonly string[];
  checksum: () => Promise<string>;
};

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
const latestVersion = portalMigrations.at(-1)?.version ?? 0;

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

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function splitSqlList(value: string): string[] {
  const output: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      current += character;
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      output.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

function identifier(value: string): string {
  return value.trim().replace(/^["`\[]|["`\]]$/g, "");
}

function uniqueConstraints(tableSql: string): string[][] {
  const start = tableSql.indexOf("(");
  const end = tableSql.lastIndexOf(")");
  if (start < 0 || end <= start) return [];
  const output: string[][] = [];
  for (const clause of splitSqlList(tableSql.slice(start + 1, end))) {
    const tableConstraint = clause.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\((.+)\)$/i);
    if (tableConstraint) {
      output.push(splitSqlList(tableConstraint[1]).map((column) => identifier(column.split(/\s+/)[0])).filter(Boolean));
      continue;
    }
    if (!/\bUNIQUE\b/i.test(clause) || /\bPRIMARY\s+KEY\b/i.test(clause)) continue;
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    if (column) output.push([column]);
  }
  return output.filter((columns) => columns.length > 0);
}

function indexColumns(indexSql: string): IndexColumn[] {
  const match = indexSql.match(/\bON\s+["`\[]?[A-Za-z_][A-Za-z0-9_]*["`\]]?\s*\((.+)\)\s*$/i);
  if (!match) return [];
  return splitSqlList(match[1]).map((value) => {
    const parts = value.trim().split(/\s+/);
    const direction = parts.at(-1)?.toUpperCase();
    const descending = direction === "DESC";
    if (direction === "ASC" || direction === "DESC") parts.pop();
    return { name: identifier(parts.join(" ")), descending };
  });
}

function normalizedSqlDefinition(value: unknown): string {
  return String(value ?? "")
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim()
    .toUpperCase();
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
  const result = await db.prepare("SELECT name, type, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<SchemaObjectRow>();
  return (result.results ?? []).map((row) => ({
    name: String(row.name ?? ""),
    type: String(row.type ?? ""),
    tbl_name: String(row.tbl_name ?? ""),
    sql: row.sql == null ? null : String(row.sql),
  }));
}

async function tableIndexList(db: D1Database, table: string): Promise<IndexListRow[]> {
  const result = await db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all<IndexListRow>();
  return (result.results ?? []).map((row) => ({
    seq: Number(row.seq ?? 0),
    name: String(row.name ?? ""),
    unique: Number(row.unique ?? 0),
    origin: String(row.origin ?? ""),
    partial: Number(row.partial ?? 0),
  }));
}

async function actualIndexColumns(db: D1Database, name: string): Promise<IndexColumn[]> {
  const result = await db.prepare(`PRAGMA index_xinfo(${quoteIdentifier(name)})`).all<IndexXInfoRow>();
  return (result.results ?? [])
    .filter((row) => Number(row.key ?? 1) === 1 && Number(row.cid ?? -1) >= 0 && row.name != null)
    .sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
    .map((row) => ({ name: String(row.name), descending: Number(row.desc ?? 0) === 1 }));
}

function sameIndexColumns(left: readonly IndexColumn[], right: readonly IndexColumn[]): boolean {
  return left.length === right.length && left.every((column, index) => (
    column.name === right[index]?.name && column.descending === right[index]?.descending
  ));
}

async function inspectStructure(db: D1Database, options: InspectOptions = {}): Promise<{ compatible: string[]; incompatible: string[] }> {
  const checkSecondary = options.secondary ?? true;
  const includeExtras = options.extras ?? true;
  const compatible = new Set<string>();
  const incompatible = new Set<string>();
  const objects = await schemaObjects(db);
  const tables = new Map(objects.filter((item) => item.type === "table").map((item) => [item.name, item]));
  const indexes = new Map(objects.filter((item) => item.type === "index").map((item) => [item.name, item]));
  const triggers = new Map(objects.filter((item) => item.type === "trigger").map((item) => [item.name, item]));
  const requiredTableNames = new Set(portalSchemaTables.map((table) => table.name));
  const requiredIndexNames = new Set(portalSchemaIndexes.map((index) => index.name));
  const requiredTriggerNames = new Set(portalSchemaTriggers.map((trigger) => trigger.name));
  const indexLists = new Map<string, IndexListRow[]>();

  for (const table of portalSchemaTables) {
    if (!tables.has(table.name)) {
      incompatible.add(`table:${table.name}:missing`);
      continue;
    }
    const info = await db.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all<TableInfoRow>();
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

    const list = await tableIndexList(db, table.name);
    indexLists.set(table.name, list);
    for (const columns of uniqueConstraints(table.sql)) {
      let found = false;
      for (const candidate of list.filter((row) => row.unique === 1 && row.partial === 0)) {
        const actualColumnsForIndex = await actualIndexColumns(db, candidate.name);
        if (sameIndexColumns(actualColumnsForIndex, columns.map((name) => ({ name, descending: false })))) {
          found = true;
          break;
        }
      }
      if (!found) incompatible.add(`unique:${table.name}.${columns.join(",")}:missing`);
    }
  }

  if (checkSecondary) {
    for (const index of portalSchemaIndexes) {
      const actual = indexes.get(index.name);
      if (!actual) {
        incompatible.add(`index:${index.name}:missing`);
        continue;
      }
      if (actual.tbl_name !== index.table) {
        incompatible.add(`index:${index.name}:wrong_table`);
        continue;
      }
      const listed = (indexLists.get(index.table) ?? []).find((row) => row.name === index.name);
      const expectedColumns = indexColumns(index.sql);
      const actualColumnsForIndex = listed ? await actualIndexColumns(db, listed.name) : [];
      if (!listed || listed.unique !== 0 || listed.partial !== 0 || !sameIndexColumns(actualColumnsForIndex, expectedColumns)) {
        incompatible.add(`index:${index.name}:definition`);
      }
    }
    for (const trigger of portalSchemaTriggers) {
      const actual = triggers.get(trigger.name);
      if (!actual) incompatible.add(`trigger:${trigger.name}:missing`);
      else if (actual.tbl_name !== trigger.table) incompatible.add(`trigger:${trigger.name}:wrong_table`);
      else if (normalizedSqlDefinition(actual.sql) !== normalizedSqlDefinition(trigger.sql)) {
        incompatible.add(`trigger:${trigger.name}:definition`);
      }
    }
  }

  if (includeExtras) {
    for (const table of tables.keys()) {
      if (!requiredTableNames.has(table) && !ignoredObject(table)) compatible.add(`table:${table}:extra`);
    }
    for (const index of indexes.keys()) {
      if (!requiredIndexNames.has(index) && !ignoredObject(index)) compatible.add(`index:${index}:extra`);
    }
    for (const trigger of triggers.keys()) {
      if (!requiredTriggerNames.has(trigger) && !ignoredObject(trigger)) compatible.add(`trigger:${trigger}:extra`);
    }
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

function driftStatus(
  rows: MigrationRow[],
  drift: { compatible: string[]; incompatible: string[] },
  verifiedAt: number,
): PortalSchemaStatus {
  const appliedVersions = rows.map((row) => row.version).sort((left, right) => left - right);
  return status("incompatible", {
    currentVersion: appliedVersions.at(-1) ?? 0,
    appliedVersions,
    pendingVersions: portalMigrations.map((migration) => migration.version).filter((version) => !appliedVersions.includes(version)),
    compatibleDrift: drift.compatible,
    incompatibleDrift: drift.incompatible,
    errorCode: "schema_incompatible_drift",
  }, verifiedAt);
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
    if (drift.incompatible.length) return driftStatus(rows, drift, verifiedAt);
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

async function renewLock(db: D1Database, owner: string, options: MigrationOptions): Promise<boolean> {
  const updated = await db.prepare("UPDATE portal_schema_lock SET acquired_at = ? WHERE id = ? AND owner = ?")
    .bind(safeNow(options), "main", owner).run();
  return resultChanges(updated) === 1;
}

async function releaseLock(db: D1Database, owner: string): Promise<void> {
  await db.prepare("DELETE FROM portal_schema_lock WHERE id = ? AND owner = ?").bind("main", owner).run();
}

function lockLostStatus(options: MigrationOptions): PortalSchemaStatus {
  return status("busy", { errorCode: "schema_migration_busy" }, safeNow(options));
}

async function applyMigration(
  db: D1Database,
  migration: PortalMigration,
  owner: string,
  options: MigrationOptions,
): Promise<PortalSchemaStatus | null> {
  const startedAt = safeNow(options);
  const phases = migration.version === baseline.version
    ? [
        portalSchemaTables.map((table) => table.sql),
        [...portalSchemaIndexes.map((index) => index.sql), ...portalSchemaTriggers.map((trigger) => trigger.sql)],
      ]
    : [migration.statements];

  for (let index = 0; index < phases.length; index += 1) {
    if (!await renewLock(db, owner, options)) return lockLostStatus(options);
    await db.batch(phases[index].map((statement) => db.prepare(statement)));
    if (!await renewLock(db, owner, options)) return lockLostStatus(options);
    if (index === 0 && phases.length > 1) {
      const preflight = await inspectStructure(db, { secondary: false, extras: false });
      if (preflight.incompatible.length) return driftStatus(await journalRows(db), preflight, safeNow(options));
    }
  }

  if (!await renewLock(db, owner, options)) return lockLostStatus(options);
  const drift = await inspectStructure(db);
  const rows = await journalRows(db);
  if (drift.incompatible.length) return driftStatus(rows, drift, safeNow(options));
  if (!await renewLock(db, owner, options)) return lockLostStatus(options);

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
      const failure = await applyMigration(env.DB, migration, owner, options);
      if (failure) return failure;
    }

    if (!await renewLock(env.DB, owner, options)) return lockLostStatus(options);
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
