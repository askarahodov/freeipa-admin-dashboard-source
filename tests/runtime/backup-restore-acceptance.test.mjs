import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKUP_RESTORE_ACCEPTANCE_DOMAINS,
  executeBackupRestoreAcceptance,
} from "../../scripts/backup-restore-acceptance-core.mjs";

function session() {
  return { authenticated: true, user: { id: "admin-1", username: "accept-admin", role: "admin" } };
}

function settings(revision = 7) {
  return {
    revision,
    settings: { demoMode: false },
    fields: { demoMode: { source: "database" } },
  };
}

function encryptedDocument() {
  return {
    manifest: {
      format: "freeipa-admin-dashboard-backup",
      version: 1,
      mode: "encrypted",
      domains: [...BACKUP_RESTORE_ACCEPTANCE_DOMAINS],
      entries: BACKUP_RESTORE_ACCEPTANCE_DOMAINS.map((domain) => ({
        domain,
        path: `domains/${domain}.json`,
        records: 1,
        bytes: 64,
        sha256: "a".repeat(64),
      })),
      encryption: {
        algorithm: "AES-256-GCM",
        kdf: "PBKDF2-SHA-256",
        iterations: 210000,
        salt: "safe-salt",
      },
    },
    payloads: {},
    summary: {
      entries: BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length,
      records: BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length,
      bytes: 512,
    },
  };
}

function restoreDomains() {
  const checks = {
    settings: ["settings-consistency"],
    "local-auth": ["local-auth-integrity"],
    rbac: ["rbac-consistency"],
    policies: ["json-fields"],
    catalog: ["json-fields"],
    operations: ["operation-references"],
    approvals: ["approval-references"],
    audit: ["json-fields"],
  };
  return BACKUP_RESTORE_ACCEPTANCE_DOMAINS.map((domain) => ({
    domain,
    tables: 1,
    records: 1,
    checks: checks[domain],
    warnings: [],
  }));
}

function requestHarness({ changedRevision = false } = {}) {
  const calls = [];
  let snapshotReads = 0;
  const document = encryptedDocument();
  const token = "b".repeat(64);

  async function request(pathname, options = {}) {
    calls.push({ pathname, options });
    if (pathname === "/api/auth/session") return { status: 200, json: session() };
    if (pathname === "/api/integrations/settings/effective") {
      snapshotReads += 1;
      return { status: 200, json: settings(changedRevision && snapshotReads > 1 ? 8 : 7) };
    }
    if (pathname === "/api/admin/backups/export/encrypted") {
      assert.equal(options.method, "POST");
      assert.deepEqual(options.body.domains, BACKUP_RESTORE_ACCEPTANCE_DOMAINS);
      assert.equal(options.body.password, "test-only-backup-password");
      return { status: 200, json: document };
    }
    if (pathname === "/api/admin/backups/import/encrypted/preview") {
      assert.equal(options.body.document, document);
      assert.equal(options.body.password, "test-only-backup-password");
      return {
        status: 200,
        json: {
          canRestore: true,
          selectedDomains: [...BACKUP_RESTORE_ACCEPTANCE_DOMAINS],
          requiredMigrations: [],
          summary: { conflict: 0 },
          restorePlan: {
            selectedDomains: [...BACKUP_RESTORE_ACCEPTANCE_DOMAINS],
            approvalToken: token,
          },
        },
      };
    }
    if (pathname === "/api/admin/backups/import/encrypted/test-restore") {
      assert.equal(options.body.document, document);
      assert.equal(options.body.approvalToken, token);
      return {
        status: 200,
        json: {
          tested: true,
          productionMutated: false,
          canCommit: true,
          selectedDomains: [...BACKUP_RESTORE_ACCEPTANCE_DOMAINS],
          sourceSchemaVersion: 7,
          currentSchemaVersion: 7,
          summary: {
            tables: BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length,
            records: BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length,
            checks: BACKUP_RESTORE_ACCEPTANCE_DOMAINS.length,
            warnings: 0,
          },
          domains: restoreDomains(),
        },
      };
    }
    throw new Error(`unexpected request: ${pathname}`);
  }

  return { request, calls };
}

test("backup acceptance verifies encrypted export, preview and isolated restore without production mutation", async () => {
  const harness = requestHarness();
  const result = await executeBackupRestoreAcceptance({
    request: harness.request,
    password: "test-only-backup-password",
  });

  assert.deepEqual(result, {
    outcome: "passed",
    backup: "encrypted_verified",
    preview: "verified",
    isolatedRestore: "verified",
    productionState: "unchanged",
  });
  assert.deepEqual(
    harness.calls.map((call) => call.pathname),
    [
      "/api/auth/session",
      "/api/integrations/settings/effective",
      "/api/admin/backups/export/encrypted",
      "/api/admin/backups/import/encrypted/preview",
      "/api/admin/backups/import/encrypted/test-restore",
      "/api/auth/session",
      "/api/integrations/settings/effective",
    ],
  );
  assert.equal(JSON.stringify(result).includes("test-only-backup-password"), false);
});

test("backup acceptance fails closed if active portal state changes after isolated restore", async () => {
  const harness = requestHarness({ changedRevision: true });
  await assert.rejects(
    () => executeBackupRestoreAcceptance({
      request: harness.request,
      password: "test-only-backup-password",
    }),
    /acceptance_backup_production_state_changed/u,
  );
});


test("backup acceptance rejects a restore result that claims production mutation", async () => {
  const harness = requestHarness();
  const request = async (pathname, options) => {
    const response = await harness.request(pathname, options);
    if (pathname === "/api/admin/backups/import/encrypted/test-restore") {
      return { ...response, json: { ...response.json, productionMutated: true } };
    }
    return response;
  };

  await assert.rejects(
    () => executeBackupRestoreAcceptance({
      request,
      password: "test-only-backup-password",
    }),
    /acceptance_backup_test_restore_invalid/u,
  );
});

test("backup acceptance requires a zero-conflict restorable preview", async () => {
  const harness = requestHarness();
  const request = async (pathname, options) => {
    const response = await harness.request(pathname, options);
    if (pathname === "/api/admin/backups/import/encrypted/preview") {
      return { ...response, json: { ...response.json, canRestore: false } };
    }
    return response;
  };

  await assert.rejects(
    () => executeBackupRestoreAcceptance({
      request,
      password: "test-only-backup-password",
    }),
    /acceptance_backup_preview_invalid/u,
  );
});

test("backup acceptance maps raw export failures to a bounded code", async () => {
  const harness = requestHarness();
  const request = async (pathname, options) => {
    if (pathname === "/api/admin/backups/export/encrypted") {
      return { status: 500, json: { error: "raw password=do-not-report" } };
    }
    return harness.request(pathname, options);
  };

  await assert.rejects(
    () => executeBackupRestoreAcceptance({
      request,
      password: "do-not-report-backup-password",
    }),
    (error) => {
      assert.equal(error.message, "acceptance_backup_export_failed");
      assert.equal(String(error).includes("do-not-report"), false);
      return true;
    },
  );
});

test("backup acceptance validates its in-memory password before any portal call", async () => {
  let called = false;
  await assert.rejects(
    () => executeBackupRestoreAcceptance({
      request: async () => {
        called = true;
        return { status: 500, json: {} };
      },
      password: "short",
    }),
    /acceptance_backup_password_invalid/u,
  );
  assert.equal(called, false);
});
