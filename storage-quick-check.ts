export type StorageQuickCheckState = "healthy" | "failed" | "unsupported" | "unavailable";

export type StorageQuickCheckResult = {
  state: StorageQuickCheckState;
};

type StorageQuickCheckRow = Record<string, unknown>;

type StorageQuickCheckQuery = {
  first(sql: string): Promise<StorageQuickCheckRow | null>;
};

const QUICK_CHECK_SQL = "PRAGMA quick_check(1)";

function firstRowValue(row: StorageQuickCheckRow | null): unknown {
  if (!row) return undefined;
  return Object.values(row)[0];
}

function unsupportedQuickCheck(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:no such|unknown|unsupported)\s+pragma|pragma[^\n]{0,80}(?:not supported|unsupported)/i.test(message);
}

export async function inspectStorageQuickCheck(
  query: StorageQuickCheckQuery,
): Promise<StorageQuickCheckResult> {
  try {
    const value = firstRowValue(await query.first(QUICK_CHECK_SQL));
    return typeof value === "string" && value.trim().toLowerCase() === "ok"
      ? { state: "healthy" }
      : { state: "failed" };
  } catch (error) {
    return unsupportedQuickCheck(error)
      ? { state: "unsupported" }
      : { state: "unavailable" };
  }
}
