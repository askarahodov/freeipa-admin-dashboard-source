import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { RecoveryError } from "./recovery-errors.ts";
import { openSqliteHeader, runSqlite, type RecoverySqliteDependencies } from "./recovery-sqlite.ts";

export type PortalDatabaseInspection = {
  matches: boolean;
  schemaVersion: number;
};

export type RecoveryDiscoverySqlite = {
  inspectPortalDatabase(path: string): Promise<PortalDatabaseInspection>;
};

export class RecoveryDiscoveryError extends RecoveryError {
  readonly candidates: readonly string[];

  constructor(code: string, message: string, candidates: readonly string[] = []) {
    super(code, 4, message);
    this.name = "RecoveryDiscoveryError";
    this.candidates = [...candidates];
  }
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");
const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_FILES = 4_096;
const MAX_DISCLOSED_CANDIDATES = 10;
const MAX_PATH_BYTES = 4_096;
const REQUIRED_IDENTITY_TABLES = [
  "app_settings",
  "portal_audit_events",
  "portal_maintenance_state",
  "portal_schema_migrations",
  "portal_users",
] as const;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalid(): never {
  throw new RecoveryDiscoveryError("recovery_discovery_invalid", "Portal database discovery request is invalid");
}

function scanLimit(): never {
  throw new RecoveryDiscoveryError("recovery_scan_limit_exceeded", "Portal database scan limit was exceeded");
}

function contained(root: string, child: string): boolean {
  const offset = relative(root, child);
  return offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset));
}

async function canonicalDataRoot(value: unknown): Promise<string> {
  if (typeof value !== "string"
      || !value
      || !isAbsolute(value)
      || value.includes("\0")
      || byteLength(value) > MAX_PATH_BYTES) {
    invalid();
  }
  try {
    const metadata = await lstat(value);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) invalid();
    return await realpath(value);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    invalid();
  }
}

function validateLimit(value: unknown, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || Number(result) < 1 || Number(result) > maximum) invalid();
  return Number(result);
}

function parseInspectionOutput(stdout: string): PortalDatabaseInspection {
  const tables: string[] = [];
  let schemaVersion = 0;
  for (const line of stdout.trim().split(/\r?\n/u).filter(Boolean)) {
    if (line.startsWith("TABLE|")) tables.push(line.slice("TABLE|".length));
    if (line.startsWith("VERSION|")) schemaVersion = Number(line.slice("VERSION|".length));
  }
  const canonicalTables = [...new Set(tables)].sort();
  return {
    matches: canonicalTables.length === REQUIRED_IDENTITY_TABLES.length
      && canonicalTables.every((name, index) => name === REQUIRED_IDENTITY_TABLES[index])
      && Number.isSafeInteger(schemaVersion)
      && schemaVersion >= 1,
    schemaVersion: Number.isSafeInteger(schemaVersion) && schemaVersion >= 1 ? schemaVersion : 0,
  };
}

export function createRecoveryDiscoverySqlite(
  dependencies: RecoverySqliteDependencies = {},
): RecoveryDiscoverySqlite {
  return {
    async inspectPortalDatabase(path: string): Promise<PortalDatabaseInspection> {
      const tableList = REQUIRED_IDENTITY_TABLES.map((name) => `'${name}'`).join(",");
      try {
        const result = await runSqlite({
          databasePath: path,
          mode: "read-only",
          script: [
            `SELECT 'TABLE|' || name FROM sqlite_schema WHERE type = 'table' AND name IN (${tableList}) ORDER BY name;`,
            "SELECT 'VERSION|' || COALESCE(MAX(version), 0) FROM portal_schema_migrations;",
          ].join("\n"),
          maxOutputBytes: 65_536,
        }, dependencies);
        return parseInspectionOutput(result.stdout);
      } catch {
        return { matches: false, schemaVersion: 0 };
      }
    },
  };
}

async function hasSqliteHeader(path: string): Promise<boolean> {
  try {
    const header = await openSqliteHeader(path);
    return header.byteLength === SQLITE_HEADER.byteLength && header.equals(SQLITE_HEADER);
  } catch {
    return false;
  }
}

export async function discoverPortalDatabase(input: {
  dataRoot: string;
  maxDepth?: number;
  maxFiles?: number;
  sqlite?: RecoveryDiscoverySqlite;
}): Promise<string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const dataRoot = await canonicalDataRoot(input.dataRoot);
  const maxDepth = validateLimit(input.maxDepth, DEFAULT_MAX_DEPTH, 64);
  const maxFiles = validateLimit(input.maxFiles, DEFAULT_MAX_FILES, 100_000);
  const sqlite = input.sqlite ?? createRecoveryDiscoverySqlite();
  if (!sqlite || typeof sqlite.inspectPortalDatabase !== "function") invalid();

  const candidates: string[] = [];
  const pending: Array<{ directory: string; depth: number }> = [{ directory: dataRoot, depth: 0 }];
  let files = 0;

  while (pending.length) {
    const current = pending.shift()!;
    const directory = await opendir(current.directory);
    const entries = [];
    for await (const entry of directory) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const path = resolve(current.directory, entry.name);
      if (!contained(dataRoot, path) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth >= maxDepth) scanLimit();
        pending.push({ directory: path, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      if (files > maxFiles) scanLimit();
      if (!(await hasSqliteHeader(path))) continue;
      let canonicalPath: string;
      try {
        canonicalPath = await realpath(path);
      } catch {
        continue;
      }
      if (!contained(dataRoot, canonicalPath)) continue;
      let inspection: PortalDatabaseInspection;
      try {
        inspection = await sqlite.inspectPortalDatabase(canonicalPath);
      } catch {
        continue;
      }
      if (inspection.matches && Number.isSafeInteger(inspection.schemaVersion) && inspection.schemaVersion >= 1) {
        candidates.push(canonicalPath);
      }
    }
  }

  const unique = [...new Set(candidates)].sort();
  if (unique.length === 0) {
    throw new RecoveryDiscoveryError("recovery_database_not_found", "Portal database was not found");
  }
  if (unique.length > 1) {
    const disclosed = unique
      .map((path) => relative(dataRoot, path))
      .sort()
      .slice(0, MAX_DISCLOSED_CANDIDATES);
    throw new RecoveryDiscoveryError("recovery_database_ambiguous", "Portal database discovery is ambiguous", disclosed);
  }
  return unique[0];
}
