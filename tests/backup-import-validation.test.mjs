import assert from "node:assert/strict";
import test from "node:test";
import { createBackupEntry, PORTAL_BACKUP_FORMAT, PORTAL_BACKUP_VERSION } from "../backup-manifest.ts";
import { validateBackupImportDocument } from "../backup-import-preview.ts";

async function documentFor(payload = { records: [{ id: "singleton", updated_at: 1 }] }) {
  const entry = await createBackupEntry({ domain: "settings", path: "domains/settings.json", payload, records: payload.records.length });
  return {
    manifest: {
      format: PORTAL_BACKUP_FORMAT,
      version: PORTAL_BACKUP_VERSION,
      createdAt: "2026-07-31T07:00:00.000Z",
      schemaVersion: 7,
      mode: "sanitized",
      domains: ["settings"],
      entries: [entry],
      encryption: null,
    },
    payloads: { [entry.path]: payload },
    summary: { entries: 1, records: entry.records, bytes: entry.bytes },
  };
}

test("accepts a canonical sanitized backup document", async () => {
  const input = await documentFor();
  const result = await validateBackupImportDocument(input);
  assert.deepEqual(result.manifest.domains, ["settings"]);
  assert.deepEqual(Object.keys(result.payloads), ["domains/settings.json"]);
});

test("rejects unknown top-level fields and unsupported encrypted backups", async () => {
  const extra = await documentFor();
  extra.extra = true;
  await assert.rejects(() => validateBackupImportDocument(extra), (error) => error.code === "backup_request_invalid");

  const encrypted = await documentFor();
  encrypted.manifest.mode = "encrypted";
  encrypted.manifest.encryption = { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: 210000, salt: "AAAAAAAAAAAAAAAAAAAAAA==" };
  await assert.rejects(() => validateBackupImportDocument(encrypted), (error) => error.code === "backup_mode_unsupported");
});

test("rejects non-canonical domains and entry/path/payload mismatches", async () => {
  const nonCanonical = await documentFor();
  const auditPayload = { records: [] };
  const auditEntry = await createBackupEntry({ domain: "audit", path: "domains/audit.json", payload: auditPayload, records: 0 });
  nonCanonical.manifest.domains = ["audit", "settings"];
  nonCanonical.manifest.entries = [auditEntry, nonCanonical.manifest.entries[0]];
  nonCanonical.payloads[auditEntry.path] = auditPayload;
  nonCanonical.summary = { entries: 2, records: 1, bytes: auditEntry.bytes + nonCanonical.manifest.entries[1].bytes };
  await assert.rejects(() => validateBackupImportDocument(nonCanonical), (error) => error.code === "backup_request_invalid");

  const missing = await documentFor();
  delete missing.payloads["domains/settings.json"];
  await assert.rejects(() => validateBackupImportDocument(missing), (error) => error.code === "backup_payload_missing");

  const extra = await documentFor();
  extra.payloads["domains/extra.json"] = { records: [] };
  await assert.rejects(() => validateBackupImportDocument(extra), (error) => error.code === "backup_payload_unexpected");

  const wrongPath = await documentFor();
  wrongPath.manifest.entries[0].path = "domains/audit.json";
  wrongPath.payloads = { "domains/audit.json": wrongPath.payloads["domains/settings.json"] };
  await assert.rejects(() => validateBackupImportDocument(wrongPath), (error) => error.code === "backup_request_invalid");
});

test("rejects corrupted byte counts, checksums, record counts and summary", async () => {
  const bytes = await documentFor();
  bytes.manifest.entries[0].bytes += 1;
  await assert.rejects(() => validateBackupImportDocument(bytes), (error) => error.code === "backup_corrupted");

  const checksum = await documentFor();
  checksum.manifest.entries[0].sha256 = "0".repeat(64);
  await assert.rejects(() => validateBackupImportDocument(checksum), (error) => error.code === "backup_corrupted");

  const records = await documentFor();
  records.manifest.entries[0].records = 2;
  await assert.rejects(() => validateBackupImportDocument(records), (error) => error.code === "backup_corrupted");

  const summary = await documentFor();
  summary.summary.bytes += 1;
  await assert.rejects(() => validateBackupImportDocument(summary), (error) => error.code === "backup_corrupted");
});

test("rejects secret-bearing sanitized payloads before comparison", async () => {
  const input = await documentFor({ records: [{ id: "singleton", password_hash: "secret" }] });
  await assert.rejects(() => validateBackupImportDocument(input), (error) => error.code === "backup_payload_unsafe");
});

test("rejects unsupported format, version and domain declarations", async () => {
  const format = await documentFor();
  format.manifest.format = "other-backup";
  await assert.rejects(() => validateBackupImportDocument(format), (error) => error.code === "backup_request_invalid");

  const version = await documentFor();
  version.manifest.version = 99;
  await assert.rejects(() => validateBackupImportDocument(version), (error) => error.code === "backup_request_invalid");

  const domain = await documentFor();
  domain.manifest.domains = ["unknown"];
  domain.manifest.entries[0].domain = "unknown";
  await assert.rejects(() => validateBackupImportDocument(domain), (error) => error.code === "backup_request_invalid");
});
