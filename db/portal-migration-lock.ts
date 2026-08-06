export const DEFAULT_MIGRATION_LOCK_TTL_MS = 60_000;

export type PortalMigrationLockInspection = {
  state: "available" | "held" | "stale" | "unavailable";
  blocking: boolean;
  ageMs: number | null;
  ttlMs: number;
};

export type PortalMigrationLockOptions = {
  now?: () => number;
  maxLockAttempts?: number;
  lockTtlMs?: number;
  ttlMs?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type LockRow = { acquired_at?: unknown };

function safeNow(options: PortalMigrationLockOptions = {}): number {
  const value = options.now?.() ?? Date.now();
  return Number.isFinite(value) ? Math.trunc(value) : Date.now();
}

function resultChanges(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const result = value as { meta?: { changes?: number }; changes?: number };
  return Number(result.meta?.changes ?? result.changes ?? 0);
}

export function boundedMigrationLockTtl(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MIGRATION_LOCK_TTL_MS;
  return Math.max(1_000, Math.min(Math.trunc(parsed), 600_000));
}

function lockTtl(options: PortalMigrationLockOptions): number {
  return boundedMigrationLockTtl(options.ttlMs ?? options.lockTtlMs);
}

export async function inspectPortalMigrationLock(
  db: D1Database,
  options: PortalMigrationLockOptions = {},
): Promise<PortalMigrationLockInspection> {
  const ttlMs = lockTtl(options);
  try {
    const row = await db.prepare("SELECT acquired_at FROM portal_schema_lock WHERE id = ? LIMIT 1")
      .bind("main")
      .first<LockRow>();
    if (!row) return { state: "available", blocking: false, ageMs: null, ttlMs };
    const acquiredAt = Number(row.acquired_at);
    const now = safeNow(options);
    if (!Number.isSafeInteger(acquiredAt) || acquiredAt < 0 || acquiredAt > now) {
      return { state: "unavailable", blocking: true, ageMs: null, ttlMs };
    }
    const ageMs = Math.min(now - acquiredAt, Number.MAX_SAFE_INTEGER);
    return ageMs > ttlMs
      ? { state: "stale", blocking: false, ageMs, ttlMs }
      : { state: "held", blocking: true, ageMs, ttlMs };
  } catch {
    return { state: "unavailable", blocking: true, ageMs: null, ttlMs };
  }
}

export async function acquirePortalMigrationLock(
  db: D1Database,
  owner: string,
  options: PortalMigrationLockOptions = {},
): Promise<boolean> {
  const attempts = Math.max(1, Math.min(Math.trunc(options.maxLockAttempts ?? 5), 20));
  const ttlMs = lockTtl(options);
  const delay = Math.max(0, Math.min(Math.trunc(options.retryDelayMs ?? 50), 1_000));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const now = safeNow(options);
    await db.prepare("DELETE FROM portal_schema_lock WHERE id = ? AND acquired_at < ?")
      .bind("main", now - ttlMs)
      .run();
    const inserted = await db.prepare("INSERT OR IGNORE INTO portal_schema_lock (id, owner, acquired_at) VALUES (?, ?, ?)")
      .bind("main", owner, now)
      .run();
    if (resultChanges(inserted) === 1) return true;
    if (attempt + 1 < attempts && delay > 0) await sleep(delay);
  }
  return false;
}

export async function renewPortalMigrationLock(
  db: D1Database,
  owner: string,
  options: PortalMigrationLockOptions = {},
): Promise<boolean> {
  const updated = await db.prepare("UPDATE portal_schema_lock SET acquired_at = ? WHERE id = ? AND owner = ?")
    .bind(safeNow(options), "main", owner)
    .run();
  return resultChanges(updated) === 1;
}

export async function releasePortalMigrationLock(
  db: D1Database,
  owner: string,
): Promise<void> {
  await db.prepare("DELETE FROM portal_schema_lock WHERE id = ? AND owner = ?")
    .bind("main", owner)
    .run();
}
