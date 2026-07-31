import test from "node:test";
import assert from "node:assert/strict";
import { handleEncryptedBackupExportRequest } from "../worker/backup-encrypted-export-entry.ts";
import { handleEncryptedBackupPreviewRequest } from "../worker/backup-encrypted-preview-entry.ts";

const context = { identity: "admin@example.test", role: "admin", groups: ["admins"] };
const fakeManifest = {
  format: "freeipa-admin-dashboard-backup", version: 1, createdAt: "2026-07-31T09:00:00.000Z", schemaVersion: 1, mode: "encrypted",
  domains: ["settings"], entries: [{ domain: "settings", path: "domains/settings.json", bytes: 100, sha256: "a".repeat(64), records: 1 }],
  encryption: { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: 210000, salt: "AQEBAQEBAQEBAQEBAQEBAQ==" },
};
const fakeDocument = { manifest: fakeManifest, payloads: { "domains/settings.json": { iv: "AgICAgICAgICAgIC", ciphertext: "AwMDAwMDAwMDAwMDAwMDAw==" } }, summary: { entries: 1, records: 1, bytes: 100 } };

test("encrypted export returns attachment and audits only aggregate metadata", async () => {
  const audits = [];
  const response = await handleEncryptedBackupExportRequest(
    new Request("https://portal.test/api/admin/backups/export/encrypted", { method: "POST", body: JSON.stringify({ domains: ["settings"], password: "top secret password" }) }),
    { DB: {} },
    context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1 }; },
      async exportBackup(_env, options) { assert.equal(options.password, "top secret password"); return fakeDocument; },
      async appendAudit(_env, _context, event) { audits.push(event); },
      now: () => 100,
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /portal-full-backup-2026-07-31\.json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), fakeDocument);
  assert.equal(audits[0].action, "backup.encrypted.export.completed");
  const auditText = JSON.stringify(audits);
  assert.doesNotMatch(auditText, /top secret|salt|iv|ciphertext|sha256|password/i);
});

test("encrypted export enforces body limit before handler", async () => {
  let called = false;
  const response = await handleEncryptedBackupExportRequest(
    new Request("https://portal.test/api/admin/backups/export/encrypted", { method: "POST", headers: { "content-length": "20000" }, body: "{}" }),
    { DB: {} }, context,
    { async exportBackup() { called = true; return fakeDocument; } },
  );
  assert.equal(response.status, 413);
  assert.equal(called, false);
});

test("encrypted export normalizes arbitrary dependency errors", async () => {
  const audits = [];
  const response = await handleEncryptedBackupExportRequest(
    new Request("https://portal.test/api/admin/backups/export/encrypted", { method: "POST", body: JSON.stringify({ domains: ["settings"], password: "top secret password" }) }),
    { DB: {} }, context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1 }; },
      async exportBackup() { throw Object.assign(new Error("raw top secret failure"), { code: "top secret password", status: 422 }); },
      async appendAudit(_env, _context, event) { audits.push(event); },
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Encrypted backup export failed", code: "backup_encrypted_export_failed" });
  assert.doesNotMatch(JSON.stringify(audits), /top secret password|raw top secret/);
});

test("encrypted preview returns safe counts and sanitized failure", async () => {
  const audits = [];
  const requestBody = { document: fakeDocument, password: "top secret password" };
  const response = await handleEncryptedBackupPreviewRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/preview", { method: "POST", body: JSON.stringify(requestBody) }),
    { DB: {} }, context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1, appliedVersions: [1] }; },
      async previewBackup(_env, document, password) {
        assert.deepEqual(document, fakeDocument);
        assert.equal(password, "top secret password");
        return { selectedDomains: ["settings"], requiredMigrations: [], canRestore: true, summary: { add: 1, update: 0, unchanged: 0, conflict: 0, removeIgnored: 0 }, domains: [], backup: { sourceSchemaVersion: 1, currentSchemaVersion: 1 } };
      },
      async appendAudit(_env, _context, event) { audits.push(event); },
      now: () => 100,
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).summary.add, 1);
  assert.doesNotMatch(JSON.stringify(audits), /top secret|salt|iv|ciphertext|sha256|password/i);

  const failed = await handleEncryptedBackupPreviewRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/preview", { method: "POST", body: JSON.stringify(requestBody) }),
    { DB: {} }, context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1 }; },
      async previewBackup() { throw Object.assign(new Error("raw crypto OperationError top secret"), { code: "backup_decryption_failed", status: 422 }); },
      async appendAudit(_env, _context, event) { audits.push(event); },
    },
  );
  assert.equal(failed.status, 422);
  assert.deepEqual(await failed.json(), { error: "Backup decryption failed", code: "backup_decryption_failed" });

  const maliciousAudits = [];
  const malicious = structuredClone(requestBody);
  malicious.document.manifest.domains = ["settings", "top secret password"];
  const rejected = await handleEncryptedBackupPreviewRequest(
    new Request("https://portal.test/api/admin/backups/import/encrypted/preview", { method: "POST", body: JSON.stringify(malicious) }),
    { DB: {} }, context,
    {
      async inspectSchema() { return { state: "ready", currentVersion: 1 }; },
      async previewBackup() { throw Object.assign(new Error("invalid"), { code: "backup_request_invalid", status: 400 }); },
      async appendAudit(_env, _context, event) { maliciousAudits.push(event); },
    },
  );
  assert.equal(rejected.status, 400);
  assert.doesNotMatch(JSON.stringify(maliciousAudits), /top secret password/);
});
