import assert from "node:assert/strict";
import test from "node:test";

import { inspectStorageMigrationPreflight } from "../src/storage/migration/preflight/storage-migration-preflight.ts";

const applied = {
  version: 1,
  name: "baseline",
  checksum: async () => "checksum-1",
  snapshot: { tables: [], indexes: [], triggers: [] },
};

function completeJournal() {
  return [{ version: 1, name: "baseline", checksum: "checksum-1" }];
}

test("no-pending preflight skips future-object, quick-check, backup and lock reads", async () => {
  const calls = [];
  const report = await inspectStorageMigrationPreflight({ DB: {} }, {
    registry: [applied],
    now: () => 10_000,
    readJournal: async () => completeJournal(),
    inspectAppliedSchema: async () => ({ state: "ready", code: "migration_schema_ready" }),
    detectPartialFuture: async () => { calls.push("future"); return false; },
    quickCheck: async () => { calls.push("quick"); return { state: "healthy" }; },
    readBackupCandidates: async () => { calls.push("backup"); return []; },
    inspectLock: async () => {
      calls.push("lock");
      return { state: "available", blocking: false, ageMs: null, ttlMs: 60_000 };
    },
  });

  assert.equal(report.state, "not_required");
  assert.deepEqual(calls, []);
});

test("pending migration without deterministic snapshot is ineligible for controlled apply", async () => {
  const pendingWithoutSnapshot = {
    version: 2,
    name: "unsupported-pending",
    checksum: async () => "checksum-2",
    statements: [],
  };
  const report = await inspectStorageMigrationPreflight({ DB: {} }, {
    registry: [applied, pendingWithoutSnapshot],
    now: () => 10_000,
    readJournal: async () => completeJournal(),
    inspectAppliedSchema: async () => ({ state: "ready", code: "migration_schema_ready" }),
  });

  assert.equal(report.state, "blocked");
  assert.equal(report.decision, "deny");
  assert.equal(report.code, "migration_registry_snapshot_required");
  assert.equal(report.schema.code, "migration_registry_snapshot_required");
  assert.equal(JSON.stringify(report).includes("unsupported-pending"), false);
});
