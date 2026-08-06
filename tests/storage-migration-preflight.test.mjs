import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectStorageMigrationPreflight,
  unavailableStorageMigrationPreflightReport,
} from "../storage-migration-preflight.ts";

const registry = [
  {
    version: 1,
    name: "baseline",
    checksum: async () => "checksum-1",
    snapshot: { tables: [{ name: "base" }], indexes: [], triggers: [] },
  },
  {
    version: 2,
    name: "second",
    checksum: async () => "checksum-2",
    snapshot: { tables: [{ name: "second" }], indexes: [], triggers: [] },
  },
];

const journalV1 = [{
  version: 1,
  name: "baseline",
  checksum: "checksum-1",
  applied_at: 1,
  execution_ms: 1,
}];

function dependencies(overrides = {}) {
  return {
    registry,
    now: () => 100_000,
    readJournal: async () => journalV1,
    inspectAppliedSchema: async () => ({ state: "ready", code: "migration_schema_ready" }),
    detectPartialFuture: async () => false,
    quickCheck: async () => ({ state: "healthy" }),
    readBackupCandidates: async () => [{
      createdAt: 90_000,
      schemaVersion: 1,
      domains: ["settings", "local-auth", "rbac", "policies", "catalog", "operations", "approvals", "audit"],
    }],
    inspectLock: async () => ({
      state: "available",
      blocking: false,
      ageMs: null,
      ttlMs: 60_000,
    }),
    ...overrides,
  };
}

function expectedReady(overrides = {}) {
  return {
    contractVersion: "1",
    generatedAt: 100_000,
    durationMs: 0,
    state: "ready",
    decision: "allow",
    code: "migration_preflight_ready",
    pendingMigrationCount: 1,
    schema: {
      state: "ready",
      currentVersion: 1,
      latestVersion: 2,
      code: "migration_schema_ready",
    },
    journal: {
      state: "valid",
      appliedCount: 1,
      pendingCount: 1,
      code: "migration_journal_valid",
    },
    integrity: { state: "healthy", code: "migration_quick_check_ok" },
    backup: {
      state: "ready",
      ageMs: 10_000,
      maxAgeMs: 86_400_000,
      code: "migration_backup_ready",
    },
    lock: {
      state: "available",
      blocking: false,
      ageMs: null,
      ttlMs: 60_000,
      code: "migration_lock_available",
    },
    ...overrides,
  };
}

test("valid applied prefix with pending migration is ready and bounded", async () => {
  const report = await inspectStorageMigrationPreflight({ DB: {} }, dependencies());
  assert.deepEqual(report, expectedReady());
  assert.equal(JSON.stringify(report).includes("baseline"), false);
  assert.equal(JSON.stringify(report).includes("checksum-1"), false);
});

test("no pending migrations returns explicit not-required checks without running expensive readers", async () => {
  const called = [];
  const report = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    readJournal: async () => [
      journalV1[0],
      { version: 2, name: "second", checksum: "checksum-2", applied_at: 2, execution_ms: 1 },
    ],
    quickCheck: async () => { called.push("quick"); throw new Error("must not run"); },
    readBackupCandidates: async () => { called.push("backup"); throw new Error("must not run"); },
    inspectLock: async () => { called.push("lock"); throw new Error("must not run"); },
  }));

  assert.equal(report.state, "not_required");
  assert.equal(report.decision, "deny");
  assert.equal(report.code, "migration_preflight_not_required");
  assert.equal(report.pendingMigrationCount, 0);
  assert.deepEqual(report.integrity, { state: "not_required", code: "migration_quick_check_not_required" });
  assert.deepEqual(report.backup, {
    state: "not_required",
    ageMs: null,
    maxAgeMs: 86_400_000,
    code: "migration_backup_not_required",
  });
  assert.deepEqual(report.lock, {
    state: "not_required",
    blocking: false,
    ageMs: null,
    ttlMs: 60_000,
    code: "migration_lock_not_required",
  });
  assert.deepEqual(called, []);
});

test("journal name/checksum/gap/future problems block before other checks", async () => {
  for (const [rows, code] of [
    [[{ ...journalV1[0], name: "wrong" }], "migration_journal_checksum_mismatch"],
    [[{ ...journalV1[0], checksum: "wrong" }], "migration_journal_checksum_mismatch"],
    [[{ version: 2, name: "second", checksum: "checksum-2" }], "migration_journal_gap"],
    [[...journalV1, { version: 3, name: "future", checksum: "future" }], "migration_journal_future_version"],
    [[journalV1[0], journalV1[0]], "migration_journal_duplicate"],
    [[{ version: "1", name: "baseline", checksum: "checksum-1" }], "migration_journal_malformed"],
  ]) {
    const report = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({ readJournal: async () => rows }));
    assert.equal(report.state, "blocked");
    assert.equal(report.decision, "deny");
    assert.equal(report.code, code);
    assert.equal(report.journal.state, "invalid");
  }
});

test("applied-prefix drift and partial future objects block without exposing object names", async () => {
  const drift = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    inspectAppliedSchema: async () => ({ state: "incompatible", code: "migration_schema_incompatible" }),
  }));
  assert.equal(drift.code, "migration_schema_incompatible");

  const partial = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    detectPartialFuture: async () => true,
  }));
  assert.equal(partial.code, "migration_schema_partial_apply");
  assert.equal(JSON.stringify(partial).includes("second"), false);
});

test("quick check, backup and lock results use deterministic deny priority", async () => {
  const quick = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    quickCheck: async () => ({ state: "failed" }),
    readBackupCandidates: async () => [],
    inspectLock: async () => ({ state: "held", blocking: true, ageMs: 1, ttlMs: 60_000 }),
  }));
  assert.equal(quick.code, "migration_quick_check_failed");

  const backup = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    readBackupCandidates: async () => [],
    inspectLock: async () => ({ state: "held", blocking: true, ageMs: 1, ttlMs: 60_000 }),
  }));
  assert.equal(backup.code, "migration_backup_missing");

  const lock = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    inspectLock: async () => ({ state: "held", blocking: true, ageMs: 10_000, ttlMs: 60_000 }),
  }));
  assert.equal(lock.code, "migration_lock_held");
});

test("stale lock is visible but non-blocking", async () => {
  const report = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    inspectLock: async () => ({ state: "stale", blocking: false, ageMs: 60_001, ttlMs: 60_000 }),
  }));
  assert.equal(report.state, "ready");
  assert.equal(report.decision, "allow");
  assert.deepEqual(report.lock, {
    state: "stale",
    blocking: false,
    ageMs: 60_001,
    ttlMs: 60_000,
    code: "migration_lock_stale",
  });
});

test("backup must be recent, current-version and cover every canonical domain exactly once", async () => {
  const staleNow = 100_000_000;
  const stale = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    now: () => staleNow,
    readBackupCandidates: async () => [{
      createdAt: staleNow - 86_400_001,
      schemaVersion: 1,
      domains: ["settings", "local-auth", "rbac", "policies", "catalog", "operations", "approvals", "audit"],
    }],
  }));
  assert.equal(stale.backup.state, "stale");
  assert.equal(stale.code, "migration_backup_stale");

  const incompatible = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    readBackupCandidates: async () => [{
      createdAt: 99_000,
      schemaVersion: 2,
      domains: ["settings", "local-auth", "rbac", "policies", "catalog", "operations", "approvals", "audit"],
    }],
  }));
  assert.equal(incompatible.backup.state, "incompatible");
  assert.equal(incompatible.code, "migration_backup_incompatible");

  const partial = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    readBackupCandidates: async () => [{
      createdAt: 99_000,
      schemaVersion: 1,
      domains: ["settings", "local-auth"],
    }],
  }));
  assert.equal(partial.backup.state, "incompatible");
});

test("unavailable dependency states fail closed with full fixed report", async () => {
  const noDb = await inspectStorageMigrationPreflight({}, dependencies());
  assert.equal(noDb.state, "unavailable");
  assert.equal(noDb.code, "migration_preflight_database_unavailable");

  const journal = await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    readJournal: async () => { throw new Error("raw-path /var/lib/private.sqlite"); },
  }));
  assert.equal(journal.state, "unavailable");
  assert.equal(journal.code, "migration_journal_unavailable");
  assert.equal(JSON.stringify(journal).includes("private.sqlite"), false);

  const fixed = unavailableStorageMigrationPreflightReport(123, 9);
  assert.equal(fixed.contractVersion, "1");
  assert.equal(fixed.state, "unavailable");
  assert.equal(fixed.decision, "deny");
  assert.equal(fixed.generatedAt, 123);
  assert.equal(fixed.durationMs, 9);
  assert.equal(fixed.pendingMigrationCount, 0);
});

test("concurrent evaluations are coalesced but completed reports are not cached", async () => {
  let journalReads = 0;
  let resolveJournal;
  const pending = new Promise((resolve) => { resolveJournal = resolve; });
  const deps = dependencies({
    readJournal: async () => {
      journalReads += 1;
      return pending;
    },
  });
  const first = inspectStorageMigrationPreflight({ DB: {} }, deps);
  const second = inspectStorageMigrationPreflight({ DB: {} }, deps);
  assert.equal(first, second);
  assert.equal(journalReads, 1);
  resolveJournal(journalV1);
  await first;

  await inspectStorageMigrationPreflight({ DB: {} }, dependencies({
    readJournal: async () => { journalReads += 1; return journalV1; },
  }));
  assert.equal(journalReads, 2);
});
