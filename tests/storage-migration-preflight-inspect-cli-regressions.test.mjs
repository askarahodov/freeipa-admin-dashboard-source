import assert from "node:assert/strict";
import test from "node:test";

import { runStorageMigrationPreflightInspectCli } from "../storage-migration-preflight-inspect-cli.ts";

const options = {
  portalUrl: "https://portal.test",
  adminToken: "service-token-sentinel",
  timeoutMs: 1500,
};

const baseUnavailable = {
  contractVersion: "1",
  generatedAt: 1_754_400_000_000,
  durationMs: 12,
  state: "unavailable",
  decision: "deny",
  code: "migration_preflight_unavailable",
  pendingMigrationCount: 0,
  schema: {
    state: "unavailable",
    currentVersion: null,
    latestVersion: 4,
    code: "migration_schema_unavailable",
  },
  journal: {
    state: "unavailable",
    appliedCount: 0,
    pendingCount: 0,
    code: "migration_journal_unavailable",
  },
  integrity: { state: "unavailable", code: "migration_quick_check_unavailable" },
  backup: {
    state: "unavailable",
    ageMs: null,
    maxAgeMs: 86_400_000,
    code: "migration_backup_unavailable",
  },
  lock: {
    state: "unavailable",
    blocking: true,
    ageMs: null,
    ttlMs: 60_000,
    code: "migration_lock_unavailable",
  },
  correlationId: "cor_abcdef0123456789abcdef0123456789",
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function run(payload, status = 200) {
  return runStorageMigrationPreflightInspectCli(options, {
    fetchImpl: async () => response(payload, status),
  });
}

test("CLI accepts exact journal-invalid blocked reports from the evaluator", async () => {
  const payload = {
    ...baseUnavailable,
    state: "blocked",
    code: "migration_journal_gap",
    journal: {
      state: "invalid",
      appliedCount: 2,
      pendingCount: 0,
      code: "migration_journal_gap",
    },
  };
  const result = await run(payload);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
});

test("CLI accepts exact schema-incompatible blocked reports before expensive checks", async () => {
  const payload = {
    ...baseUnavailable,
    state: "blocked",
    code: "migration_schema_partial_apply",
    pendingMigrationCount: 1,
    schema: {
      state: "incompatible",
      currentVersion: 3,
      latestVersion: 4,
      code: "migration_schema_partial_apply",
    },
    journal: {
      state: "valid",
      appliedCount: 3,
      pendingCount: 1,
      code: "migration_journal_valid",
    },
  };
  const result = await run(payload);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
});

test("CLI accepts exact schema and downstream unavailable reports with HTTP 503", async () => {
  const schemaUnavailable = {
    ...baseUnavailable,
    code: "migration_schema_unavailable",
    pendingMigrationCount: 1,
    schema: {
      state: "unavailable",
      currentVersion: 3,
      latestVersion: 4,
      code: "migration_schema_unavailable",
    },
    journal: {
      state: "valid",
      appliedCount: 3,
      pendingCount: 1,
      code: "migration_journal_valid",
    },
  };
  const backupUnavailable = {
    ...baseUnavailable,
    code: "migration_backup_unavailable",
    pendingMigrationCount: 1,
    schema: {
      state: "ready",
      currentVersion: 3,
      latestVersion: 4,
      code: "migration_schema_ready",
    },
    journal: {
      state: "valid",
      appliedCount: 3,
      pendingCount: 1,
      code: "migration_journal_valid",
    },
    integrity: { state: "healthy", code: "migration_quick_check_ok" },
    backup: {
      state: "unavailable",
      ageMs: null,
      maxAgeMs: 86_400_000,
      code: "migration_backup_unavailable",
    },
    lock: {
      state: "available",
      blocking: false,
      ageMs: null,
      ttlMs: 60_000,
      code: "migration_lock_available",
    },
  };

  for (const payload of [schemaUnavailable, backupUnavailable]) {
    const result = await run(payload, 503);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${JSON.stringify(payload, null, 2)}\n`);
  }
});

test("CLI rejects cross-stage code substitution and impossible eager-check results", async () => {
  const journalInvalid = {
    ...baseUnavailable,
    state: "blocked",
    code: "migration_schema_partial_apply",
    journal: {
      state: "invalid",
      appliedCount: 2,
      pendingCount: 0,
      code: "migration_journal_gap",
    },
  };
  const schemaBlockedWithEagerBackup = {
    ...baseUnavailable,
    state: "blocked",
    code: "migration_schema_partial_apply",
    pendingMigrationCount: 1,
    schema: {
      state: "incompatible",
      currentVersion: 3,
      latestVersion: 4,
      code: "migration_schema_partial_apply",
    },
    journal: {
      state: "valid",
      appliedCount: 3,
      pendingCount: 1,
      code: "migration_journal_valid",
    },
    backup: {
      state: "ready",
      ageMs: 100,
      maxAgeMs: 86_400_000,
      code: "migration_backup_ready",
    },
  };

  for (const payload of [journalInvalid, schemaBlockedWithEagerBackup]) {
    const result = await run(payload);
    assert.equal(result.exitCode, 5);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${JSON.stringify({ ok: false, code: "storage_migration_preflight_inspect_protocol_error" })}\n`);
  }
});
