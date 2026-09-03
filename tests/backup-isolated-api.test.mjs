import test from "node:test";
import assert from "node:assert/strict";

import { BackupIsolatedRestoreError } from "../src/backup/restore/backup-isolated-restore.ts";
import { handleIsolatedBackupRestoreRequest } from "../worker/backup-isolated-restore-entry.ts";

const context = { identity: "admin@example.test", role: "admin", groups: ["admins"] };
const fakeDocument = {
  manifest: {
    format: "freeipa-admin-dashboard-backup",
    version: 1,
    createdAt: "2026-07-31T09:00:00.000Z",
    schemaVersion: 1,
    mode: "encrypted",
    domains: ["settings"],
    entries: [{ domain: "settings", path: "domains/settings.json", bytes: 100, sha256: "a".repeat(64), records: 1 }],
    encryption: { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: 210000, salt: "AQEBAQEBAQEBAQEBAQEBAQ==" },
  },
  payloads: { "domains/settings.json": { iv: "AgICAgICAgICAgIC", ciphertext: "AwMDAwMDAwMDAwMDAwMDAw==" } },
  summary: { entries: 1, records: 1, bytes: 100 },
};
const requestBody = {
  document: fakeDocument,
  password: "top secret password",
  domains: ["settings"],
  approvalToken: "a".repeat(64),
};
const result = {
  tested: true,
  productionMutated: false,
  selectedDomains: ["settings"],
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  canCommit: true,
  summary: { tables: 5, records: 1, checks: 5, warnings: 0 },
  domains: [{ domain: "settings", tables: 5, records: 1, checks: ["json-fields"], warnings: [] }],
};

test("returns safe isolated restore result and aggregate-only audit", async () => {
  const audits = [];
  const response = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }),
    { DB: {} },
    context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1, appliedVersions: [1] }; },
      async testRestore(_env, input, schema) {
        assert.deepEqual(input, requestBody);
        assert.equal(schema.currentVersion, 1);
        return result;
      },
      async appendAudit(_env, _context, event) { audits.push(event); },
      now: () => 100,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), result);
  assert.equal(audits[0].action, "backup.encrypted.test-restore.completed");
  assert.deepEqual(audits[0].metadata, {
    domains: ["settings"],
    sourceSchemaVersion: 1,
    currentSchemaVersion: 1,
    summary: result.summary,
    canCommit: true,
    durationMs: 0,
  });
  assert.doesNotMatch(JSON.stringify(audits), /top secret|approvalToken|fingerprint|sha256|salt|iv|ciphertext|hash/i);
});

test("enforces method body and exact request shape before test restore", async () => {
  let called = 0;
  const dependencies = { async testRestore() { called += 1; return result; } };

  const wrongMethod = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", { method: "GET" }),
    { DB: {} }, context, dependencies,
  );
  assert.equal(wrongMethod.status, 405);

  const tooLarge = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", {
      method: "POST",
      headers: { "content-length": String(21 * 1024 * 1024) },
      body: "{}",
    }),
    { DB: {} }, context, dependencies,
  );
  assert.equal(tooLarge.status, 413);

  for (const body of [
    "not json",
    JSON.stringify({ ...requestBody, unexpected: true }),
    JSON.stringify({ document: fakeDocument, password: "x", domains: ["settings"] }),
    JSON.stringify({ ...requestBody, approvalToken: "invalid" }),
  ]) {
    const response = await handleIsolatedBackupRestoreRequest(
      new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", { method: "POST", body }),
      { DB: {} }, context, dependencies,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(called, 0);
});

test("rejects unavailable and non-ready databases before restore orchestration", async () => {
  let called = 0;
  const testRestore = async () => { called += 1; return result; };
  const missing = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", { method: "POST", body: JSON.stringify(requestBody) }),
    {}, context, { testRestore },
  );
  assert.equal(missing.status, 503);

  const blocked = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", { method: "POST", body: JSON.stringify(requestBody) }),
    { DB: {} }, context,
    { async inspectSchema() { return { state: "blocked", currentVersion: 1 }; }, testRestore },
  );
  assert.equal(blocked.status, 409);
  assert.equal(called, 0);
});

test("preserves trusted candidate failures as 422", async () => {
  const response = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", { method: "POST", body: JSON.stringify(requestBody) }),
    { DB: {} }, context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1 }; },
      async testRestore() {
        throw new BackupIsolatedRestoreError(
          "backup_test_restore_failed",
          422,
          "internal candidate details",
        );
      },
    },
  );
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "Backup test restore failed",
    code: "backup_test_restore_failed",
  });
});

test("normalizes stale and arbitrary failures without leaking request material", async () => {
  const audits = [];
  const stale = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", { method: "POST", body: JSON.stringify(requestBody) }),
    { DB: {} }, context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1 }; },
      async testRestore() { throw Object.assign(new Error("raw top secret"), { code: "backup_restore_stale", status: 409 }); },
      async appendAudit(_env, _context, event) { audits.push(event); },
    },
  );
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: "Backup restore preview is stale", code: "backup_restore_stale" });

  const arbitrary = await handleIsolatedBackupRestoreRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/test-restore", { method: "POST", body: JSON.stringify(requestBody) }),
    { DB: {} }, context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1 }; },
      async testRestore() { throw Object.assign(new Error("raw top secret"), { code: "top secret password", status: 422 }); },
      async appendAudit(_env, _context, event) { audits.push(event); },
    },
  );
  assert.equal(arbitrary.status, 500);
  assert.deepEqual(await arbitrary.json(), { error: "Backup test restore failed", code: "backup_test_restore_failed" });
  assert.doesNotMatch(JSON.stringify(audits), /top secret|approvalToken|sha256|salt|iv|ciphertext|hash/i);
});