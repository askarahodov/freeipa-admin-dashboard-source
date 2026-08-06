import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MIGRATION_LOCK_TTL_MS,
  acquirePortalMigrationLock,
  boundedMigrationLockTtl,
  inspectPortalMigrationLock,
  releasePortalMigrationLock,
  renewPortalMigrationLock,
} from "../db/portal-migration-lock.ts";

function database(handler) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            first: async () => handler({ kind: "first", sql, args }),
            run: async () => handler({ kind: "run", sql, args }),
          };
        },
        first: async () => {
          calls.push({ sql, args: [] });
          return handler({ kind: "first", sql, args: [] });
        },
      };
    },
  };
}

test("lock TTL is fixed by default and safely bounded", () => {
  assert.equal(DEFAULT_MIGRATION_LOCK_TTL_MS, 60_000);
  assert.equal(boundedMigrationLockTtl(undefined), 60_000);
  assert.equal(boundedMigrationLockTtl(-1), 1_000);
  assert.equal(boundedMigrationLockTtl(999), 1_000);
  assert.equal(boundedMigrationLockTtl(700_000), 600_000);
  assert.equal(boundedMigrationLockTtl(Number.NaN), 60_000);
});

test("read-only inspection selects only acquired_at and classifies available, held and stale", async () => {
  for (const [row, now, expected] of [
    [null, 100_000, { state: "available", blocking: false, ageMs: null, ttlMs: 60_000 }],
    [{ acquired_at: 80_000 }, 100_000, { state: "held", blocking: true, ageMs: 20_000, ttlMs: 60_000 }],
    [{ acquired_at: 40_000 }, 100_000, { state: "held", blocking: true, ageMs: 60_000, ttlMs: 60_000 }],
    [{ acquired_at: 39_999 }, 100_000, { state: "stale", blocking: false, ageMs: 60_001, ttlMs: 60_000 }],
  ]) {
    const db = database(({ kind }) => kind === "first" ? row : null);
    assert.deepEqual(await inspectPortalMigrationLock(db, { now: () => now }), expected);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].sql, "SELECT acquired_at FROM portal_schema_lock WHERE id = ? LIMIT 1");
    assert.deepEqual(db.calls[0].args, ["main"]);
    assert.equal(db.calls[0].sql.includes("owner"), false);
  }
});

test("malformed or failed lock reads fail closed without raw details", async () => {
  const malformed = database(() => ({ acquired_at: "owner-secret" }));
  assert.deepEqual(await inspectPortalMigrationLock(malformed), {
    state: "unavailable",
    blocking: true,
    ageMs: null,
    ttlMs: 60_000,
  });

  const failed = database(() => { throw new Error("owner-secret /var/lib/private.sqlite"); });
  const result = await inspectPortalMigrationLock(failed);
  assert.deepEqual(result, {
    state: "unavailable",
    blocking: true,
    ageMs: null,
    ttlMs: 60_000,
  });
  assert.equal(JSON.stringify(result).includes("owner-secret"), false);
});

test("acquisition reclaims only stale main lock and atomically inserts the supplied owner", async () => {
  const db = database(({ sql }) => {
    if (sql.startsWith("DELETE")) return { meta: { changes: 1 } };
    if (sql.startsWith("INSERT")) return { meta: { changes: 1 } };
    return { meta: { changes: 0 } };
  });

  const acquired = await acquirePortalMigrationLock(db, "owner-123", {
    now: () => 100_000,
    ttlMs: 60_000,
    maxLockAttempts: 1,
  });
  assert.equal(acquired, true);
  assert.deepEqual(db.calls, [
    {
      sql: "DELETE FROM portal_schema_lock WHERE id = ? AND acquired_at < ?",
      args: ["main", 40_000],
    },
    {
      sql: "INSERT OR IGNORE INTO portal_schema_lock (id, owner, acquired_at) VALUES (?, ?, ?)",
      args: ["main", "owner-123", 100_000],
    },
  ]);
});

test("renew and release are owner scoped", async () => {
  const db = database(() => ({ meta: { changes: 1 } }));
  assert.equal(await renewPortalMigrationLock(db, "owner-456", { now: () => 123_456 }), true);
  await releasePortalMigrationLock(db, "owner-456");
  assert.deepEqual(db.calls, [
    {
      sql: "UPDATE portal_schema_lock SET acquired_at = ? WHERE id = ? AND owner = ?",
      args: [123_456, "main", "owner-456"],
    },
    {
      sql: "DELETE FROM portal_schema_lock WHERE id = ? AND owner = ?",
      args: ["main", "owner-456"],
    },
  ]);
});

test("failed insert retries within bounds and uses injected sleep", async () => {
  let inserts = 0;
  const sleeps = [];
  const db = database(({ sql }) => {
    if (sql.startsWith("INSERT")) {
      inserts += 1;
      return { meta: { changes: inserts === 2 ? 1 : 0 } };
    }
    return { meta: { changes: 0 } };
  });
  const acquired = await acquirePortalMigrationLock(db, "owner-retry", {
    now: () => 100_000,
    maxLockAttempts: 2,
    retryDelayMs: 25,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  assert.equal(acquired, true);
  assert.deepEqual(sleeps, [25]);
  assert.equal(inserts, 2);
});
