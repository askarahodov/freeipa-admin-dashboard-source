import assert from "node:assert/strict";
import test from "node:test";

import { portalMaintenanceStateTable } from "../db/portal-maintenance-schema.ts";
import { portalRestoreStageTable } from "../db/portal-restore-stage-schema.ts";
import { portalSchemaTables } from "../db/portal-schema.ts";
import { inspectStorageStatus } from "../src/storage/status/storage-status.ts";

const canonicalTables = [
  ...portalSchemaTables.map((table) => table.name),
  portalMaintenanceStateTable.name,
  portalRestoreStageTable.name,
];

function readySchema(overrides = {}) {
  return {
    state: "ready",
    currentVersion: 3,
    latestVersion: 3,
    appliedVersions: [1, 2, 3],
    pendingVersions: [],
    compatibleDrift: [],
    incompatibleDrift: [],
    errorCode: null,
    verifiedAt: 1_754_000_000_000,
    ...overrides,
  };
}

function queryFixture(options = {}) {
  const calls = [];
  const query = {
    async all(sql) {
      calls.push(sql);
      if (sql.includes("sqlite_master")) {
        if (options.inventoryError) throw new Error(options.inventoryError);
        return canonicalTables.map((name) => ({ name }));
      }
      throw new Error(`unexpected all query: ${sql}`);
    },
    async first(sql) {
      calls.push(sql);
      if (sql === "PRAGMA page_count") {
        if (options.sizeError) throw new Error(options.sizeError);
        return { page_count: 12 };
      }
      if (sql === "PRAGMA page_size") {
        if (options.sizeError) throw new Error(options.sizeError);
        return { page_size: 4096 };
      }
      if (sql.includes("MAX(CASE WHEN action LIKE")) {
        if (options.lifecycleError) throw new Error(options.lifecycleError);
        return { last_backup_at: 1_754_100_000_000, last_restore_at: 1_754_200_000_000 };
      }
      if (sql.startsWith("SELECT COUNT(*) AS count FROM")) {
        if (options.countError && sql.includes(options.countError)) throw new Error("database-password-sentinel");
        return { count: 2 };
      }
      throw new Error(`unexpected first query: ${sql}`);
    },
  };
  return { query, calls };
}

test("healthy storage status aggregates only fixed domains and bounded metadata", async () => {
  const { query, calls } = queryFixture();
  const report = await inspectStorageStatus(
    { DB: {}, CONFIG_ENCRYPTION_KEY: "a".repeat(64) },
    {
      query,
      inspectSchema: async () => readySchema(),
      encryptionSelfTest: async () => true,
      now: () => 1_754_300_000_000,
    },
  );

  assert.equal(report.contractVersion, "1");
  assert.equal(report.generatedAt, 1_754_300_000_000);
  assert.equal(report.state, "healthy");
  assert.deepEqual(report.database, {
    available: true,
    pageCount: 12,
    pageSize: 4096,
    logicalBytes: 49_152,
    code: "storage_size_available",
  });
  assert.equal(report.schema.state, "ready");
  assert.equal(report.schema.currentVersion, 3);
  assert.equal(report.schema.latestVersion, 3);
  assert.deepEqual(report.schema.appliedVersions, [1, 2, 3]);
  assert.deepEqual(report.schema.pendingVersions, []);
  assert.equal(report.schema.compatibleDriftCount, 0);
  assert.equal(report.schema.incompatibleDriftCount, 0);
  assert.equal(report.encryption.state, "ready");
  assert.deepEqual(report.lifecycle, {
    lastBackupAt: 1_754_100_000_000,
    lastRestoreAt: 1_754_200_000_000,
    lastCleanupAt: null,
    code: "storage_lifecycle_available",
  });

  assert.deepEqual(
    report.domains.map((domain) => domain.name),
    ["settings", "operations", "catalog", "approvals", "identity", "audit", "maintenance", "restore", "other"],
  );
  assert.equal(report.domains.reduce((sum, domain) => sum + domain.expectedTables, 0), canonicalTables.length);
  assert.equal(report.domains.reduce((sum, domain) => sum + domain.presentTables, 0), canonicalTables.length);
  assert.equal(report.domains.reduce((sum, domain) => sum + domain.records, 0), canonicalTables.length * 2);
  assert.ok(report.domains.every((domain) => domain.code === "storage_domain_counted"));

  const lifecycleQuery = calls.find((sql) => sql.includes("last_backup_at"));
  assert.ok(lifecycleQuery);
  assert.match(lifecycleQuery, /backup\.%export%\.completed/);
  assert.match(lifecycleQuery, /backup\.restore\.%/);
  assert.equal(lifecycleQuery.includes("action LIKE 'backup.%'"), false);
  assert.equal(lifecycleQuery.includes("action LIKE 'restore.%'"), false);

  const serialized = JSON.stringify(report);
  for (const forbidden of ["portal_users", "portal_sessions", "sqlite_master", "CONFIG_ENCRYPTION_KEY", "aaaaaaaaaaaaaaaa"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.ok(calls.length <= canonicalTables.length + 4, `unexpected query count: ${calls.length}`);
  assert.ok(calls.filter((sql) => sql.startsWith("SELECT COUNT(*) AS count FROM")).every((sql) => canonicalTables.some((name) => sql === `SELECT COUNT(*) AS count FROM "${name}"`)));
});

test("partial local failures produce degraded fixed codes without raw details", async () => {
  const secret = "https://db.internal.example database-password-sentinel";
  const { query } = queryFixture({
    sizeError: secret,
    lifecycleError: secret,
    countError: "portal_sessions",
  });
  const report = await inspectStorageStatus(
    { DB: {}, CONFIG_ENCRYPTION_KEY: secret },
    {
      query,
      inspectSchema: async () => readySchema({
        state: "busy",
        pendingVersions: [4],
        compatibleDrift: ["table:internal_safe_addition"],
        incompatibleDrift: ["table:portal_users:raw-secret-sentinel"],
        errorCode: `schema_pending ${secret}`,
      }),
      encryptionSelfTest: async () => false,
      now: () => 1_754_300_000_100,
    },
  );

  assert.equal(report.state, "degraded");
  assert.equal(report.database.available, true);
  assert.equal(report.database.logicalBytes, null);
  assert.equal(report.database.code, "storage_size_unavailable");
  assert.equal(report.schema.state, "busy");
  assert.deepEqual(report.schema.pendingVersions, [4]);
  assert.equal(report.schema.compatibleDriftCount, 1);
  assert.equal(report.schema.incompatibleDriftCount, 1);
  assert.equal(report.schema.errorCode, "schema_unready");
  assert.equal(report.encryption.state, "unavailable");
  assert.equal(report.lifecycle.code, "storage_lifecycle_unavailable");
  assert.equal(report.domains.find((domain) => domain.name === "identity")?.code, "storage_domain_partial");

  const serialized = JSON.stringify(report);
  for (const forbidden of ["db.internal.example", "database-password-sentinel", "portal_sessions", "portal_users", "raw-secret-sentinel"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("missing database returns unavailable without invoking schema or queries", async () => {
  let schemaCalls = 0;
  let queryCalls = 0;
  const report = await inspectStorageStatus(
    {},
    {
      query: {
        async all() { queryCalls += 1; return []; },
        async first() { queryCalls += 1; return null; },
      },
      inspectSchema: async () => { schemaCalls += 1; return readySchema(); },
      encryptionSelfTest: async () => true,
      now: () => 1_754_300_000_200,
    },
  );

  assert.equal(report.state, "unavailable");
  assert.equal(report.database.available, false);
  assert.equal(report.database.code, "storage_database_unavailable");
  assert.equal(report.schema.state, "unknown");
  assert.equal(schemaCalls, 0);
  assert.equal(queryCalls, 0);
});

test("inventory failure is unavailable and never exposes the thrown error", async () => {
  const secret = "file:///var/lib/private.sqlite authorization-bearer-sentinel";
  const { query } = queryFixture({ inventoryError: secret });
  const report = await inspectStorageStatus(
    { DB: {} },
    {
      query,
      inspectSchema: async () => readySchema(),
      encryptionSelfTest: async () => true,
    },
  );

  assert.equal(report.state, "unavailable");
  assert.equal(report.database.available, false);
  assert.equal(report.database.code, "storage_inventory_unavailable");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("private.sqlite"), false);
  assert.equal(serialized.includes("authorization-bearer-sentinel"), false);
});
