import {
  portalSchemaIndexes,
  portalSchemaTables,
  portalSchemaTriggers,
  type PortalSchemaColumn,
  type PortalSchemaIndex,
  type PortalSchemaTable,
  type PortalSchemaTrigger,
} from "./portal-schema.ts";
import {
  portalMigrationV1SecondaryStatements,
  portalMigrationV1Statements,
  portalMigrationV1TableStatements,
} from "./portal-migration-v1.ts";
import {
  acquirePortalMigrationLock,
  releasePortalMigrationLock,
  renewPortalMigrationLock,
} from "./portal-migration-lock.ts";

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
type TableInfoRow = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
type IndexListRow = { seq: number; name: string; unique: number; origin: string; partial: number };
type IndexXInfoRow = { seqno: number; cid: number; name: string | null; desc: number; key: number };
type IndexColumn = { name: string; descending: boolean };
type UniqueConstraintDefinition = { columns: string[]; conflictPolicy: string };

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
  allowMissingSecondary?: boolean;
};

export type PortalSchemaSnapshot = {
  tables: readonly PortalSchemaTable[];
  indexes: readonly PortalSchemaIndex[];
  triggers: readonly PortalSchemaTrigger[];
};

export type PortalMigration = {
  version: number;
  name: string;
  statements: readonly string[];
  tableStatements?: readonly string[];
  secondaryStatements?: readonly string[];
  snapshot?: PortalSchemaSnapshot;
  checksum: () => Promise<string>;
};

const canonicalSnapshot: PortalSchemaSnapshot = {
  tables: portalSchemaTables,
  indexes: portalSchemaIndexes,
  triggers: portalSchemaTriggers,
};
const migrationTableSql = portalSchemaTables.find((table) => table.name === "portal_schema_migrations")!.sql;
const migrationLockSql = portalSchemaTables.find((table) => table.name === "portal_schema_lock")!.sql;
let successfulCache = new WeakMap<object, { expiresAt: number; status: PortalSchemaStatus }>();
let inFlightEnsures = new WeakMap<object, Promise<PortalSchemaStatus>>();

function safeNow(options?: MigrationOptions): number {
  const value = options?.now?.() ?? Date.now();
  return Number.isFinite(value) ? Math.trunc(value) : Date.now();
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checksum(version: number, name: string, statements: readonly string[]): Promise<string> {
  const material = JSON.stringify({ version, name, statements });
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)));
}

function latestVersion(registry: readonly PortalMigration[]): number {
  return registry.reduce((latest, migration) => Math.max(latest, migration.version), 0);
}

function pendingVersions(registry: readonly PortalMigration[], appliedVersions: readonly number[]): number[] {
  const applied = new Set(appliedVersions);
  return registry.map((migration) => migration.version).filter((version) => !applied.has(version));
}

function status(
  registry: readonly PortalMigration[],
  state: PortalSchemaState,
  values: Partial<Omit<PortalSchemaStatus, "state" | "latestVersion" | "verifiedAt">> = {},
  verifiedAt = Date.now(),
): PortalSchemaStatus {
  return {
    state,
    currentVersion: values.currentVersion ?? 0,
    latestVersion: latestVersion(registry),
    appliedVersions: [...(values.appliedVersions ?? [])],
    pendingVersions: [...(values.pendingVersions ?? registry.map((migration) => migration.version))],
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

function normalizedIdentifier(value: unknown): string {
  return identifier(String(value ?? "")).toLowerCase();
}

function tableBody(tableSql: string): string {
  const start = tableSql.indexOf("(");
  const end = tableSql.lastIndexOf(")");
  return start >= 0 && end > start ? tableSql.slice(start + 1, end) : "";
}

function conflictPolicy(value: unknown): string {
  return String(value ?? "ABORT").trim().toUpperCase() || "ABORT";
}

function uniqueConstraintDefinitions(tableSql: string): UniqueConstraintDefinition[] {
  const output: UniqueConstraintDefinition[] = [];
  for (const clause of splitSqlList(tableBody(tableSql))) {
    const tableConstraint = clause.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\(([^)]*)\)(?:\s+ON\s+CONFLICT\s+(ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))?/i);
    if (tableConstraint) {
      const columns = splitSqlList(tableConstraint[1])
        .map((column) => identifier(column.split(/\s+/)[0]))
        .filter(Boolean);
      if (columns.length) output.push({ columns, conflictPolicy: conflictPolicy(tableConstraint[2]) });
      continue;
    }
    if (!/\bUNIQUE\b/i.test(clause) || /\bPRIMARY\s+KEY\b/i.test(clause)) continue;
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    const inlineUnique = clause.match(/\bUNIQUE\b(?:\s+ON\s+CONFLICT\s+(ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))?/i);
    if (column && inlineUnique) output.push({ columns: [column], conflictPolicy: conflictPolicy(inlineUnique[1]) });
  }
  return output;
}

function uniqueConstraints(tableSql: string): string[][] {
  return uniqueConstraintDefinitions(tableSql).map((definition) => definition.columns);
}

function primaryKeyColumns(tableSql: string): string[] {
  const clauses = splitSqlList(tableBody(tableSql));
  for (const clause of clauses) {
    const tablePrimaryKey = clause.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i);
    if (tablePrimaryKey) {
      return splitSqlList(tablePrimaryKey[1])
        .map((column) => identifier(column.split(/\s+/)[0]))
        .filter(Boolean);
    }
  }
  return clauses.flatMap((clause) => {
    if (!/\bPRIMARY\s+KEY\b/i.test(clause)) return [];
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    return column ? [column] : [];
  });
}

function sqlDefaultIsNull(value: unknown): boolean {
  if (value == null) return true;
  let normalized = String(value).trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return /^NULL$/i.test(normalized);
}

function normalizedSqlDefinition(value: unknown): string {
  return String(value ?? "")
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim()
    .toUpperCase();
}

function restrictiveConstraintSignatures(tableSql: unknown): string[] {
  return splitSqlList(tableBody(String(tableSql ?? "")))
    .filter((clause) => /\bCHECK\s*\(|\bFOREIGN\s+KEY\b|\bREFERENCES\b/i.test(clause))
    .map((clause) => normalizedSqlDefinition(clause))
    .sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameIdentifiers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => (
    normalizedIdentifier(value) === normalizedIdentifier(right[index])
  ));
}

function tableFromSql(statement: string): PortalSchemaTable | null {
  const match = statement.trim().match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
  if (!match) return null;
  const clauses = splitSqlList(tableBody(statement));
  const tablePrimaryKeys = new Set(primaryKeyColumns(statement).map(normalizedIdentifier));
  const columns: PortalSchemaColumn[] = [];
  for (const clause of clauses) {
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+(TEXT|INTEGER)\b(.*)$/i);
    if (!column) continue;
    const name = column[1];
    const tail = column[3];
    columns.push({
      name,
      type: column[2].toUpperCase() as PortalSchemaColumn["type"],
      notNull: /\bNOT\s+NULL\b/i.test(tail),
      primaryKey: /\bPRIMARY\s+KEY\b/i.test(tail) || tablePrimaryKeys.has(normalizedIdentifier(name)),
    });
  }
  return { name: match[1], columns, sql: statement };
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

function indexFromSql(statement: string): PortalSchemaIndex | null {
  const match = statement.trim().match(/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  return match ? { name: match[1], table: match[2], sql: statement } : null;
}

function triggerFromSql(statement: string): PortalSchemaTrigger | null {
  const match = statement.trim().match(/^CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)[\s\S]*?\bON\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  return match ? { name: match[1], table: match[2], sql: statement } : null;
}

function snapshotFromStatements(statements: readonly string[]): PortalSchemaSnapshot {
  return {
    tables: statements.map(tableFromSql).filter((value): value is PortalSchemaTable => Boolean(value)),
    indexes: statements.map(indexFromSql).filter((value): value is PortalSchemaIndex => Boolean(value)),
    triggers: statements.map(triggerFromSql).filter((value): value is PortalSchemaTrigger => Boolean(value)),
  };
}

const baselineSnapshot = snapshotFromStatements(portalMigrationV1Statements);
const baseline: PortalMigration = {
  version: 1,
  name: "canonical-runtime-baseline",
  statements: portalMigrationV1Statements,
  tableStatements: portalMigrationV1TableStatements,
  secondaryStatements: portalMigrationV1SecondaryStatements,
  snapshot: baselineSnapshot,
  checksum: () => checksum(1, "canonical-runtime-baseline", portalMigrationV1Statements),
};

export const portalMigrations = Object.freeze([baseline]) satisfies readonly PortalMigration[];

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
    normalizedIdentifier(column.name) === normalizedIdentifier(right[index]?.name)
    && column.descending === right[index]?.descending
  ));
}

export async function inspectPortalSchemaSnapshot(
  db: D1Database,
  snapshot: PortalSchemaSnapshot = canonicalSnapshot,
  options: InspectOptions = {},
): Promise<{ compatible: string[]; incompatible: string[] }> {
  const checkSecondary = options.secondary ?? true;
  const includeExtras = options.extras ?? true;
  const allowMissingSecondary = options.allowMissingSecondary ?? false;
  const compatible = new Set<string>();
  const incompatible = new Set<string>();
  const objects = await schemaObjects(db);
  const tables = new Map(objects.filter((item) => item.type === "table").map((item) => [normalizedIdentifier(item.name), item]));
  const indexes = new Map(objects.filter((item) => item.type === "index").map((item) => [normalizedIdentifier(item.name), item]));
  const triggers = new Map(objects.filter((item) => item.type === "trigger").map((item) => [normalizedIdentifier(item.name), item]));
  const requiredTableNames = new Set(snapshot.tables.map((table) => normalizedIdentifier(table.name)));
  const requiredIndexNames = new Set(snapshot.indexes.map((index) => normalizedIdentifier(index.name)));
  const requiredTriggerNames = new Set(snapshot.triggers.map((trigger) => normalizedIdentifier(trigger.name)));
  const canonicalTableByName = new Map(snapshot.tables.map((table) => [normalizedIdentifier(table.name), table]));
  const indexLists = new Map<string, IndexListRow[]>();

  for (const table of snapshot.tables) {
    const tableKey = normalizedIdentifier(table.name);
    const actualTable = tables.get(tableKey);
    if (!actualTable) {
      incompatible.add(`table:${table.name}:missing`);
      continue;
    }
    const expectedRestrictions = restrictiveConstraintSignatures(table.sql);
    const actualRestrictions = restrictiveConstraintSignatures(actualTable.sql);
    if (!sameStrings(actualRestrictions, expectedRestrictions)) {
      incompatible.add(`table:${table.name}:restrictive_constraints`);
    }
    const info = await db.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all<TableInfoRow>();
    const infoRows = info.results ?? [];
    const actualColumns = new Map(infoRows.map((column) => [normalizedIdentifier(column.name), column]));
    const requiredColumns = new Set(table.columns.map((column) => normalizedIdentifier(column.name)));
    const expectedPrimaryKey = primaryKeyColumns(table.sql);
    const actualPrimaryKey = infoRows
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => String(column.name));
    if (!sameIdentifiers(actualPrimaryKey, expectedPrimaryKey)) {
      incompatible.add(`primary_key:${table.name}:definition`);
    }
    for (const required of table.columns) {
      const actual = actualColumns.get(normalizedIdentifier(required.name));
      if (!actual) {
        incompatible.add(`column:${table.name}.${required.name}:missing`);
        continue;
      }
      const mismatch = columnMismatch(required, actual);
      if (mismatch) incompatible.add(`column:${table.name}.${required.name}:${mismatch}`);
    }
    for (const [nameKey, actual] of actualColumns) {
      if (requiredColumns.has(nameKey)) continue;
      const name = String(actual.name);
      if (Number(actual.notnull) === 1 && sqlDefaultIsNull(actual.dflt_value) && Number(actual.pk) === 0) {
        incompatible.add(`column:${table.name}.${name}:required_extra`);
      } else compatible.add(`column:${table.name}.${name}:extra`);
    }

    const list = await tableIndexList(db, table.name);
    indexLists.set(tableKey, list);
    const actualUniqueDefinitions = uniqueConstraintDefinitions(String(actualTable.sql ?? ""));
    for (const requiredUnique of uniqueConstraintDefinitions(table.sql)) {
      let candidate: IndexListRow | undefined;
      for (const possible of list.filter((row) => row.unique === 1 && row.partial === 0)) {
        const actualColumnsForIndex = await actualIndexColumns(db, possible.name);
        if (sameIndexColumns(actualColumnsForIndex, requiredUnique.columns.map((name) => ({ name, descending: false })))) {
          candidate = possible;
          break;
        }
      }
      const driftPrefix = `unique:${table.name}.${requiredUnique.columns.join(",")}`;
      if (!candidate) {
        incompatible.add(`${driftPrefix}:missing`);
        continue;
      }
      const matchingDefinitions = actualUniqueDefinitions.filter((definition) => (
        sameIdentifiers(definition.columns, requiredUnique.columns)
      ));
      const conflictingPolicy = matchingDefinitions.some((definition) => (
        definition.conflictPolicy !== requiredUnique.conflictPolicy
      ));
      const unknownConstraintPolicy = matchingDefinitions.length === 0 && candidate.origin.toLowerCase() !== "c";
      if (conflictingPolicy || unknownConstraintPolicy) incompatible.add(`${driftPrefix}:conflict_policy`);
    }
  }

  if (checkSecondary) {
    for (const index of snapshot.indexes) {
      const indexKey = normalizedIdentifier(index.name);
      const tableKey = normalizedIdentifier(index.table);
      const actual = indexes.get(indexKey);
      if (!actual) {
        if (!allowMissingSecondary) incompatible.add(`index:${index.name}:missing`);
        continue;
      }
      if (normalizedIdentifier(actual.tbl_name) !== tableKey) {
        incompatible.add(`index:${index.name}:wrong_table`);
        continue;
      }
      const listed = (indexLists.get(tableKey) ?? []).find((row) => normalizedIdentifier(row.name) === indexKey);
      const expectedColumns = indexColumns(index.sql);
      const actualColumnsForIndex = listed ? await actualIndexColumns(db, listed.name) : [];
      if (!listed || listed.unique !== 0 || listed.partial !== 0 || !sameIndexColumns(actualColumnsForIndex, expectedColumns)) {
        incompatible.add(`index:${index.name}:definition`);
      }
    }
    for (const trigger of snapshot.triggers) {
      const triggerKey = normalizedIdentifier(trigger.name);
      const actual = triggers.get(triggerKey);
      if (!actual) {
        if (!allowMissingSecondary) incompatible.add(`trigger:${trigger.name}:missing`);
      } else if (normalizedIdentifier(actual.tbl_name) !== normalizedIdentifier(trigger.table)) {
        incompatible.add(`trigger:${trigger.name}:wrong_table`);
      } else if (normalizedSqlDefinition(actual.sql) !== normalizedSqlDefinition(trigger.sql)) {
        incompatible.add(`trigger:${trigger.name}:definition`);
      }
    }
  }

  if (includeExtras) {
    for (const [nameKey, table] of tables) {
      if (!requiredTableNames.has(nameKey) && !ignoredObject(table.name)) compatible.add(`table:${table.name}:extra`);
    }
    for (const [nameKey, index] of indexes) {
      if (requiredIndexNames.has(nameKey) || ignoredObject(index.name)) continue;
      const tableKey = normalizedIdentifier(index.tbl_name);
      const canonicalTable = canonicalTableByName.get(tableKey);
      if (!canonicalTable) {
        compatible.add(`index:${index.name}:extra`);
        continue;
      }
      const listed = (indexLists.get(tableKey) ?? []).find((row) => normalizedIdentifier(row.name) === nameKey);
      if (listed?.unique === 1) incompatible.add(`index:${index.name}:unexpected_unique_on_canonical_table`);
      else compatible.add(`index:${index.name}:extra`);
    }
    for (const [nameKey, trigger] of triggers) {
      if (requiredTriggerNames.has(nameKey) || ignoredObject(trigger.name)) continue;
      if (requiredTableNames.has(normalizedIdentifier(trigger.tbl_name))) {
        incompatible.add(`trigger:${trigger.name}:unexpected_on_canonical_table`);
      } else compatible.add(`trigger:${trigger.name}:extra`);
    }
  }

  return { compatible: [...compatible].sort(), incompatible: [...incompatible].sort() };
}

async function validateJournal(
  rows: MigrationRow[],
  registry: readonly PortalMigration[],
  verifiedAt: number,
): Promise<PortalSchemaStatus | null> {
  const appliedVersions = rows.map((row) => row.version).sort((left, right) => left - right);
  const currentVersion = appliedVersions.at(-1) ?? 0;
  const pending = pendingVersions(registry, appliedVersions);
  if (currentVersion > latestVersion(registry) || rows.some((row) => !registry.some((migration) => migration.version === row.version))) {
    return status(registry, "failed", { currentVersion, appliedVersions, pendingVersions: pending, errorCode: "schema_future_version" }, verifiedAt);
  }
  const expectedPrefix = registry.slice(0, appliedVersions.length).map((migration) => migration.version);
  if (!sameStrings(appliedVersions.map(String), expectedPrefix.map(String))) {
    return status(registry, "failed", { currentVersion, appliedVersions, pendingVersions: pending, errorCode: "schema_journal_gap" }, verifiedAt);
  }
  for (const row of rows) {
    const migration = registry.find((item) => item.version === row.version);
    if (!migration || row.name !== migration.name || row.checksum !== await migration.checksum()) {
      return status(registry, "failed", { currentVersion, appliedVersions, pendingVersions: pending, errorCode: "schema_checksum_mismatch" }, verifiedAt);
    }
  }
  return null;
}

function driftStatus(
  rows: MigrationRow[],
  drift: { compatible: string[]; incompatible: string[] },
  registry: readonly PortalMigration[],
  verifiedAt: number,
): PortalSchemaStatus {
  const appliedVersions = rows.map((row) => row.version).sort((left, right) => left - right);
  return status(registry, "incompatible", {
    currentVersion: appliedVersions.at(-1) ?? 0,
    appliedVersions,
    pendingVersions: pendingVersions(registry, appliedVersions),
    compatibleDrift: drift.compatible,
    incompatibleDrift: drift.incompatible,
    errorCode: "schema_incompatible_drift",
  }, verifiedAt);
}

export async function inspectPortalSchemaWithRegistry(
  env: MigrationEnv,
  registry: readonly PortalMigration[],
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  const verifiedAt = safeNow(options);
  if (!env.DB) return status(registry, "unavailable", { errorCode: "schema_database_unavailable" }, verifiedAt);
  try {
    const rows = await journalRows(env.DB);
    const invalidJournal = await validateJournal(rows, registry, verifiedAt);
    if (invalidJournal) return invalidJournal;
    const appliedVersions = rows.map((row) => row.version).sort((left, right) => left - right);
    const currentVersion = appliedVersions.at(-1) ?? 0;
    const drift = await inspectPortalSchemaSnapshot(env.DB);
    if (drift.incompatible.length) return driftStatus(rows, drift, registry, verifiedAt);
    return status(registry, "ready", {
      currentVersion,
      appliedVersions,
      pendingVersions: pendingVersions(registry, appliedVersions),
      compatibleDrift: drift.compatible,
    }, verifiedAt);
  } catch {
    return status(registry, "failed", { errorCode: "schema_migration_failed" }, verifiedAt);
  }
}

export async function inspectPortalSchema(env: MigrationEnv, options: MigrationOptions = {}): Promise<PortalSchemaStatus> {
  return inspectPortalSchemaWithRegistry(env, portalMigrations, options);
}

async function ensureInfrastructure(db: D1Database): Promise<void> {
  await db.prepare(migrationTableSql).run();
  await db.prepare(migrationLockSql).run();
}

function lockLostStatus(registry: readonly PortalMigration[], options: MigrationOptions): PortalSchemaStatus {
  return status(registry, "busy", { errorCode: "schema_migration_busy" }, safeNow(options));
}

async function journalStatement(
  db: D1Database,
  migration: PortalMigration,
  startedAt: number,
  options: MigrationOptions,
): Promise<D1PreparedStatement> {
  const completedAt = safeNow(options);
  return db.prepare("INSERT INTO portal_schema_migrations (version, name, checksum, applied_at, execution_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(migration.version, migration.name, await migration.checksum(), completedAt, Math.max(0, completedAt - startedAt));
}

async function applyMigration(
  db: D1Database,
  migration: PortalMigration,
  owner: string,
  registry: readonly PortalMigration[],
  options: MigrationOptions,
): Promise<PortalSchemaStatus | null> {
  const startedAt = safeNow(options);

  if (migration.tableStatements?.length) {
    const snapshot = migration.snapshot ?? snapshotFromStatements(migration.statements);
    if (!await renewPortalMigrationLock(db, owner, options)) return lockLostStatus(registry, options);
    await db.batch(migration.tableStatements.map((statement) => db.prepare(statement)));
    if (!await renewPortalMigrationLock(db, owner, options)) return lockLostStatus(registry, options);
    const preflight = await inspectPortalSchemaSnapshot(db, snapshot, { secondary: false, extras: false });
    if (preflight.incompatible.length) return driftStatus(await journalRows(db), preflight, registry, safeNow(options));

    if (!await renewPortalMigrationLock(db, owner, options)) return lockLostStatus(registry, options);
    const secondaryPreflight = await inspectPortalSchemaSnapshot(db, snapshot, {
      secondary: true,
      extras: false,
      allowMissingSecondary: true,
    });
    if (secondaryPreflight.incompatible.length) {
      return driftStatus(await journalRows(db), secondaryPreflight, registry, safeNow(options));
    }

    if (!await renewPortalMigrationLock(db, owner, options)) return lockLostStatus(registry, options);
    const journal = await journalStatement(db, migration, startedAt, options);
    await db.batch([
      ...(migration.secondaryStatements ?? []).map((statement) => db.prepare(statement)),
      journal,
    ]);
    if (!await renewPortalMigrationLock(db, owner, options)) return lockLostStatus(registry, options);
    return null;
  }

  if (!await renewPortalMigrationLock(db, owner, options)) return lockLostStatus(registry, options);
  const journal = await journalStatement(db, migration, startedAt, options);
  await db.batch([...migration.statements.map((statement) => db.prepare(statement)), journal]);
  if (!await renewPortalMigrationLock(db, owner, options)) return lockLostStatus(registry, options);
  return null;
}

async function runPortalSchemaEnsure(
  env: MigrationEnv & { DB: D1Database },
  registry: readonly PortalMigration[],
  options: MigrationOptions,
): Promise<PortalSchemaStatus> {
  const owner = crypto.randomUUID();
  let acquired = false;
  try {
    await ensureInfrastructure(env.DB);
    acquired = await acquirePortalMigrationLock(env.DB, owner, options);
    if (!acquired) return status(registry, "busy", { errorCode: "schema_migration_busy" }, safeNow(options));

    const rows = await journalRows(env.DB);
    const invalidJournal = await validateJournal(rows, registry, safeNow(options));
    if (invalidJournal) return invalidJournal;
    const applied = new Set(rows.map((row) => row.version));
    for (const migration of registry) {
      if (applied.has(migration.version)) continue;
      const failure = await applyMigration(env.DB, migration, owner, registry, options);
      if (failure) return failure;
      applied.add(migration.version);
    }

    if (!await renewPortalMigrationLock(env.DB, owner, options)) return lockLostStatus(registry, options);
    return await inspectPortalSchemaWithRegistry(env, registry, options);
  } catch {
    return status(registry, "failed", { errorCode: "schema_migration_failed" }, safeNow(options));
  } finally {
    if (acquired) await releasePortalMigrationLock(env.DB, owner).catch(() => {});
  }
}

export function ensurePortalSchemaWithRegistry(
  env: MigrationEnv,
  registry: readonly PortalMigration[],
  options: MigrationOptions = {},
): Promise<PortalSchemaStatus> {
  const verifiedAt = safeNow(options);
  if (!env.DB) return Promise.resolve(status(registry, "unavailable", { errorCode: "schema_database_unavailable" }, verifiedAt));
  const dbObject = env.DB as unknown as object;
  const useProductionCache = registry === portalMigrations;
  if (useProductionCache) {
    const cached = successfulCache.get(dbObject);
    if (cached && cached.expiresAt > verifiedAt) return Promise.resolve({ ...cached.status, verifiedAt });
    const inFlight = inFlightEnsures.get(dbObject);
    if (inFlight) return inFlight;
  }

  const promise = runPortalSchemaEnsure(env as MigrationEnv & { DB: D1Database }, registry, options).then((finalStatus) => {
    if (useProductionCache && finalStatus.state === "ready") {
      const ttl = Math.max(0, Math.min(Math.trunc(options.cacheTtlMs ?? 5_000), 60_000));
      successfulCache.set(dbObject, { expiresAt: safeNow(options) + ttl, status: finalStatus });
    }
    return finalStatus;
  });
  if (useProductionCache) {
    inFlightEnsures.set(dbObject, promise);
    void promise.finally(() => {
      if (inFlightEnsures.get(dbObject) === promise) inFlightEnsures.delete(dbObject);
    });
  }
  return promise;
}

export function ensurePortalSchema(env: MigrationEnv, options: MigrationOptions = {}): Promise<PortalSchemaStatus> {
  return ensurePortalSchemaWithRegistry(env, portalMigrations, options);
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
  successfulCache = new WeakMap();
  inFlightEnsures = new WeakMap();
}
