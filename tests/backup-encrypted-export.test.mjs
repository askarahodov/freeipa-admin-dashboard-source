import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBackupJson, PORTAL_BACKUP_DOMAINS, sha256Hex } from "../src/backup/backup-manifest.ts";
import { FULL_BACKUP_TABLES } from "../src/backup/export/backup-full-domains.ts";
import {
  BackupEncryptedExportError,
  exportEncryptedBackup,
  parseEncryptedBackupExportRequest,
} from "../src/backup/export/backup-encrypted-export.ts";

function emptyPayload(domain, schemaVersion = 1) {
  const tables = FULL_BACKUP_TABLES.find(([item]) => item === domain)[1];
  return { domain, schemaVersion, tables: tables.map((table) => ({ name: table.name, columns: [...table.columns], primaryKey: [...table.primaryKey], rows: [] })) };
}

const registryFor = (domains, failDomain) => new Map(domains.map((domain) => [domain, {
  domain,
  path: `domains/${domain}.json`,
  async export(_env, schemaVersion) {
    if (domain === failDomain) throw new Error("sensitive raw exporter error");
    const payload = emptyPayload(domain, schemaVersion);
    if (domain === "settings") payload.tables[0].rows.push(["main", "{}", "very-secret-encrypted-blob", 1]);
    return { payload, records: payload.tables.reduce((sum, table) => sum + table.rows.length, 0) };
  },
}]));

const fixedSalt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
const ivs = Object.fromEntries(PORTAL_BACKUP_DOMAINS.map((domain, domainIndex) => [domain, Buffer.from(Array.from({ length: 12 }, (_, index) => 20 + domainIndex * 12 + index)).toString("base64")]));

test("parses exact encrypted export request and canonicalizes domains", () => {
  assert.deepEqual(parseEncryptedBackupExportRequest({ domains: ["audit", "settings"], password: "strong" }), { domains: ["settings", "audit"], password: "strong" });
  for (const invalid of [
    {},
    { domains: [], password: "strong" },
    { domains: ["settings", "settings"], password: "strong" },
    { domains: ["unknown"], password: "strong" },
    { domains: ["settings"], password: "" },
    { domains: ["settings"], password: "strong", extra: true },
  ]) {
    assert.throws(() => parseEncryptedBackupExportRequest(invalid), (error) => error instanceof BackupEncryptedExportError && error.code === "backup_request_invalid");
  }
});

test("creates deterministic encrypted manifest and hides plaintext", async () => {
  const domains = ["settings", "local-auth"];
  const document = await exportEncryptedBackup(
    { DB: {} },
    {
      domains,
      password: "correct horse battery staple",
      schemaVersion: 1,
      createdAt: "2026-07-31T09:00:00.000Z",
      salt: fixedSalt,
      iterations: 210_000,
      ivForDomain: (domain) => ivs[domain],
    },
    registryFor(domains),
  );
  assert.equal(document.manifest.mode, "encrypted");
  assert.deepEqual(document.manifest.encryption, { algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA-256", iterations: 210_000, salt: fixedSalt });
  assert.deepEqual(document.manifest.domains, domains);
  assert.deepEqual(Object.keys(document.payloads), ["domains/settings.json", "domains/local-auth.json"]);
  for (const entry of document.manifest.entries) {
    const envelope = document.payloads[entry.path];
    const canonical = canonicalBackupJson(envelope);
    assert.equal(entry.bytes, new TextEncoder().encode(canonical).byteLength);
    assert.equal(entry.sha256, await sha256Hex(canonical));
  }
  assert.equal(document.summary.records, 1);
  assert.equal(document.summary.bytes, document.manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0));
  assert.doesNotMatch(JSON.stringify(document), /very-secret-encrypted-blob|correct horse/i);
});

test("is deterministic with fixed entropy and all-or-nothing on exporter failure", async () => {
  const domains = ["settings", "audit"];
  const options = { domains, password: "strong password", schemaVersion: 1, createdAt: "2026-07-31T09:00:00.000Z", salt: fixedSalt, iterations: 210_000, ivForDomain: (domain) => ivs[domain] };
  const first = await exportEncryptedBackup({ DB: {} }, options, registryFor(domains));
  const second = await exportEncryptedBackup({ DB: {} }, options, registryFor(domains));
  assert.deepEqual(first, second);
  await assert.rejects(
    exportEncryptedBackup({ DB: {} }, options, registryFor(domains, "audit")),
    (error) => error instanceof BackupEncryptedExportError && error.code === "backup_encrypted_export_failed" && !error.message.includes("sensitive"),
  );
});
