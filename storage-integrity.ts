import { portalSchemaIndexes } from "./db/portal-schema.ts";
import type {
  StorageIntegrityIndexes,
  StorageIntegrityQuickCheck,
  StorageIntegrityReport,
} from "./storage-integrity-contract.ts";

type StorageIntegrityEnv = {
  DB?: D1Database;
};

type StorageIntegrityRow = Record<string, unknown>;

type StorageIntegrityQuery = {
  first(sql: string): Promise<StorageIntegrityRow | null>;
  all(sql: string): Promise<StorageIntegrityRow[]>;
};

type StorageIntegrityDependencies = {
  query?: StorageIntegrityQuery;
  now?: () => number;
};

const QUICK_CHECK_SQL = "PRAGMA quick_check(1)";
const INDEX_INVENTORY_SQL = "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'";
const MAX_PUBLIC_COUNT = 10_000;
const MAX_PUBLIC_DURATION_MS = 60_000;
const PORTAL_INDEX_PREFIXES = [
  "approval_",
  "catalog_",
  "operation_",
  "portal_",
  "process_",
  "xyops_",
] as const;

let inFlight: Promise<StorageIntegrityReport> | null = null;

function safeInteger(value: number, maximum = MAX_PUBLIC_COUNT): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

function safeDuration(startedAt: number, completedAt: number): number {
  return safeInteger(completedAt - startedAt, MAX_PUBLIC_DURATION_MS);
}

function defaultQuery(env: StorageIntegrityEnv): StorageIntegrityQuery {
  if (!env.DB) throw new Error("storage unavailable");
  return {
    async first(sql) {
      return await env.DB!.prepare(sql).first<StorageIntegrityRow>();
    },
    async all(sql) {
      const result = await env.DB!.prepare(sql).all<StorageIntegrityRow>();
      return result.results ?? [];
    },
  };
}

function unavailableIndexes(): StorageIntegrityIndexes {
  return {
    expected: portalSchemaIndexes.length,
    present: 0,
    missing: 0,
    mismatched: 0,
    unexpected: 0,
    code: "storage_indexes_unavailable",
  };
}

function unavailableReport(generatedAt: number, durationMs: number): StorageIntegrityReport {
  return {
    contractVersion: "1",
    generatedAt,
    durationMs,
    state: "unavailable",
    quickCheck: {
      state: "unavailable",
      code: "storage_quick_check_unavailable",
    },
    indexes: unavailableIndexes(),
  };
}

function firstRowValue(row: StorageIntegrityRow | null): unknown {
  if (!row) return undefined;
  return Object.values(row)[0];
}

function unsupportedQuickCheck(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:no such|unknown|unsupported)\s+pragma|pragma[^\n]{0,80}(?:not supported|unsupported)/i.test(message);
}

async function inspectQuickCheck(query: StorageIntegrityQuery): Promise<StorageIntegrityQuickCheck> {
  try {
    const value = firstRowValue(await query.first(QUICK_CHECK_SQL));
    if (typeof value === "string" && value.trim().toLowerCase() === "ok") {
      return {
        state: "healthy",
        code: "storage_quick_check_ok",
      };
    }
    return {
      state: "failed",
      code: "storage_quick_check_failed",
    };
  } catch (error) {
    return unsupportedQuickCheck(error)
      ? {
        state: "unsupported",
        code: "storage_quick_check_unsupported",
      }
      : {
        state: "unavailable",
        code: "storage_quick_check_unavailable",
      };
  }
}

function normalizedIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizedIndexSql(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/\bif\s+not\s+exists\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function portalOwnedIndex(name: string): boolean {
  return PORTAL_INDEX_PREFIXES.some((prefix) => name.startsWith(prefix));
}

async function inspectIndexes(query: StorageIntegrityQuery): Promise<StorageIntegrityIndexes> {
  try {
    const rows = await query.all(INDEX_INVENTORY_SQL);
    const actual = new Map<string, StorageIntegrityRow>();
    for (const row of rows) {
      const name = normalizedIdentifier(row.name);
      if (name && !actual.has(name)) actual.set(name, row);
    }

    const canonicalNames = new Set(portalSchemaIndexes.map((index) => index.name.toLowerCase()));
    let present = 0;
    let missing = 0;
    let mismatched = 0;

    for (const expected of portalSchemaIndexes) {
      const row = actual.get(expected.name.toLowerCase());
      if (!row) {
        missing += 1;
        continue;
      }
      present += 1;
      if (
        normalizedIdentifier(row.tbl_name) !== expected.table.toLowerCase()
        || normalizedIndexSql(row.sql) !== normalizedIndexSql(expected.sql)
      ) {
        mismatched += 1;
      }
    }

    let unexpected = 0;
    for (const name of actual.keys()) {
      if (!canonicalNames.has(name) && portalOwnedIndex(name)) unexpected += 1;
    }

    const result = {
      expected: safeInteger(portalSchemaIndexes.length),
      present: safeInteger(present),
      missing: safeInteger(missing),
      mismatched: safeInteger(mismatched),
      unexpected: safeInteger(unexpected),
    };
    return {
      ...result,
      code: result.missing === 0 && result.mismatched === 0 && result.unexpected === 0
        ? "storage_indexes_ready"
        : "storage_indexes_degraded",
    };
  } catch {
    return unavailableIndexes();
  }
}

function overallState(
  quickCheck: StorageIntegrityQuickCheck,
  indexes: StorageIntegrityIndexes,
): StorageIntegrityReport["state"] {
  if (quickCheck.state === "unavailable" || indexes.code === "storage_indexes_unavailable") return "unavailable";
  if (quickCheck.state !== "healthy" || indexes.code !== "storage_indexes_ready") return "degraded";
  return "healthy";
}

async function evaluateStorageIntegrity(
  env: StorageIntegrityEnv,
  dependencies: StorageIntegrityDependencies,
): Promise<StorageIntegrityReport> {
  const now = dependencies.now ?? Date.now;
  const generatedAt = safeInteger(now(), Number.MAX_SAFE_INTEGER);
  if (!env.DB) return unavailableReport(generatedAt, 0);

  let query: StorageIntegrityQuery;
  try {
    query = dependencies.query ?? defaultQuery(env);
  } catch {
    return unavailableReport(generatedAt, 0);
  }

  const quickCheck = await inspectQuickCheck(query);
  const indexes = await inspectIndexes(query);
  return {
    contractVersion: "1",
    generatedAt,
    durationMs: safeDuration(generatedAt, now()),
    state: overallState(quickCheck, indexes),
    quickCheck,
    indexes,
  };
}

export function inspectStorageIntegrity(
  env: StorageIntegrityEnv,
  dependencies: StorageIntegrityDependencies = {},
): Promise<StorageIntegrityReport> {
  if (inFlight) return inFlight;
  const evaluation = evaluateStorageIntegrity(env, dependencies);
  inFlight = evaluation.finally(() => {
    if (inFlight === evaluation || inFlight === wrapped) inFlight = null;
  });
  const wrapped = inFlight;
  return wrapped;
}
