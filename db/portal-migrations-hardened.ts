import {
  ensurePortalSchemaV2 as ensureBasePortalSchema,
  inspectPortalSchemaV2 as inspectBasePortalSchema,
  portalMigrationsV2 as portalMigrations,
} from "./portal-migrations-v2.ts";
import type { PortalSchemaStatus } from "./portal-migrations.ts";
import { portalRestoreStageTable } from "./portal-restore-stage-schema.ts";
import { portalSchemaTables, portalSchemaTriggers } from "./portal-schema.ts";

type MigrationEnv = { DB?: D1Database };
type MigrationRow = { version: number };
type SchemaObjectRow = { name: string; type: string; tbl_name: string; sql: string | null };

export function appliedMigrationJournalIsPrefix(
  appliedVersions: readonly number[],
  registryVersions: readonly number[],
): boolean {
  const applied = [...appliedVersions].sort((left, right) => left - right);
  return applied.length <= registryVersions.length
    && applied.every((version, index) => version === registryVersions[index]);
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
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

function tableBody(sql: string): string {
  const start = sql.indexOf("(");
  const end = sql.lastIndexOf(")");
  return start >= 0 && end > start ? sql.slice(start + 1, end) : "";
}

function normalizeIdentifier(value: string): string {
  return value.trim().replace(/^["`\[]|["`\]]$/g, "").toLowerCase();
}

function uniqueConstraintSignatures(sql: string): string[] {
  const signatures: string[] = [];
  for (const clause of splitSqlList(tableBody(sql))) {
    const tableConstraint = clause.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\(([^)]*)\)/i);
    if (tableConstraint) {
      const columns = splitSqlList(tableConstraint[1])
        .map((column) => normalizeIdentifier(column.split(/\s+/)[0]))
        .filter(Boolean);
      if (columns.length) signatures.push(columns.join(","));
      continue;
    }
    if (!/\bUNIQUE\b/i.test(clause) || /\bPRIMARY\s+KEY\b/i.test(clause)) continue;
    const column = clause.match(/^["`\[]?([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
    if (column) signatures.push(normalizeIdentifier(column));
  }
  return signatures.sort();
}

function restrictiveConstraintDrift(actualSql: string, expectedSql: string): string[] {
  const output: string[] = [];
  const actualChecks = countMatches(actualSql, /\bCHECK\s*\(/gi);
  const expectedChecks = countMatches(expectedSql, /\bCHECK\s*\(/gi);
  if (actualChecks > expectedChecks) output.push("check_constraint");

  const actualForeignKeys = countMatches(actualSql, /\bFOREIGN\s+KEY\b|\bREFERENCES\b/gi);
  const expectedForeignKeys = countMatches(expectedSql, /\bFOREIGN\s+KEY\b|\bREFERENCES\b/gi);
  if (actualForeignKeys > expectedForeignKeys) output.push("foreign_key_constraint");

  const expectedUnique = new Set(uniqueConstraintSignatures(expectedSql));
  const unexpectedUnique = uniqueConstraintSignatures(actualSql).some((signature) => !expectedUnique.has(signature));
  if (unexpectedUnique) output.push("unexpected_unique_constraint");
  return output;
}

export function classifyAdditionalCanonicalSchemaDrift(objects: readonly SchemaObjectRow[]): string[] {
  const incompatible = new Set<string>();
  const canonicalTables = new Map(
    [...portalSchemaTables, portalRestoreStageTable]
      .map((table) => [table.name.toLowerCase(), table]),
  );
  const canonicalTriggers = new Set(portalSchemaTriggers.map((trigger) => trigger.name.toLowerCase()));

  for (const object of objects) {
    const objectName = object.name.toLowerCase();
    const tableName = object.tbl_name.toLowerCase();
    if (object.type === "table") {
      const expected = canonicalTables.get(objectName);
      if (!expected || !object.sql) continue;
      for (const kind of restrictiveConstraintDrift(object.sql, expected.sql)) {
        incompatible.add(`table:${object.name}:${kind}`);
      }
      continue;
    }
    if (object.type === "trigger" && canonicalTables.has(tableName) && !canonicalTriggers.has(objectName)) {
      incompatible.add(`trigger:${object.name}:unexpected_on_canonical`);
    }
  }
  return [...incompatible].sort();
}

async function journalVersions(db: D1Database): Promise<number[] | null> {
  try {
    const result = await db.prepare("SELECT version FROM portal_schema_migrations ORDER BY version ASC").all<MigrationRow>();
    return (result.results ?? []).map((row) => Number(row.version));
  } catch {
    return null;
  }
}

function journalGapStatus(appliedVersions: readonly number[]): PortalSchemaStatus {
  const registryVersions = portalMigrations.map((migration) => migration.version);
  const applied = [...appliedVersions].sort((left, right) => left - right);
  return {
    state: "failed",
    currentVersion: applied.at(-1) ?? 0,
    latestVersion: registryVersions.at(-1) ?? 0,
    appliedVersions: applied,
    pendingVersions: registryVersions.filter((version) => !applied.includes(version)),
    compatibleDrift: [],
    incompatibleDrift: ["journal:applied_versions:not_prefix"],
    errorCode: "schema_journal_gap",
    verifiedAt: Date.now(),
  };
}

async function preflightJournal(env: MigrationEnv): Promise<PortalSchemaStatus | null> {
  if (!env.DB) return null;
  const applied = await journalVersions(env.DB);
  if (applied === null) return null;
  const registry = portalMigrations.map((migration) => migration.version);
  return appliedMigrationJournalIsPrefix(applied, registry) ? null : journalGapStatus(applied);
}

async function additionalDrift(db: D1Database): Promise<string[]> {
  const result = await db.prepare(
    "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all<SchemaObjectRow>();
  return classifyAdditionalCanonicalSchemaDrift((result.results ?? []).map((row) => ({
    name: String(row.name ?? ""),
    type: String(row.type ?? ""),
    tbl_name: String(row.tbl_name ?? ""),
    sql: row.sql == null ? null : String(row.sql),
  })));
}

async function hardenReadyStatus(env: MigrationEnv, schema: PortalSchemaStatus): Promise<PortalSchemaStatus> {
  if (schema.state !== "ready" || !env.DB) return schema;
  try {
    const drift = await additionalDrift(env.DB);
    if (!drift.length) return schema;
    return {
      ...schema,
      state: "incompatible",
      incompatibleDrift: [...new Set([...schema.incompatibleDrift, ...drift])].sort(),
      errorCode: "schema_incompatible_drift",
      verifiedAt: Date.now(),
    };
  } catch {
    return { ...schema, state: "failed", errorCode: "schema_migration_failed", verifiedAt: Date.now() };
  }
}

export async function ensurePortalSchema(env: MigrationEnv): Promise<PortalSchemaStatus> {
  const journal = await preflightJournal(env);
  if (journal) return journal;
  return hardenReadyStatus(env, await ensureBasePortalSchema(env));
}

export async function inspectPortalSchema(env: MigrationEnv): Promise<PortalSchemaStatus> {
  const journal = await preflightJournal(env);
  if (journal) return journal;
  return hardenReadyStatus(env, await inspectBasePortalSchema(env));
}

export type { PortalSchemaStatus } from "./portal-migrations.ts";
