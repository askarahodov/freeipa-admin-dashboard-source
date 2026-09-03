import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBackupJson, sha256Hex } from "../backup-manifest.ts";
import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import { exportEncryptedBackup } from "../src/backup/export/backup-encrypted-export.ts";
import {
  BackupEncryptedPreviewError,
  decryptEncryptedBackupDocument,
  previewEncryptedBackupImport,
  validateEncryptedBackupDocument,
} from "../src/backup/preview/backup-encrypted-preview.ts";

const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
const ivForDomain = (domain) => Buffer.from(Array.from({ length: 12 }, (_, index) => domain.length * 10 + index)).toString("base64");

function payload(domain, rowsByTable) {
  const definitions = FULL_BACKUP_TABLES.find(([item]) => item === domain)[1];
  return { domain, schemaVersion: 1, tables: definitions.map((table) => ({ name: table.name, columns: [...table.columns], primaryKey: [...table.primaryKey], rows: rowsByTable[table.name] ?? [] })) };
}

function registry() {
  return new Map([
    ["settings", { domain: "settings", path: "domains/settings.json", async export() {
      const value = payload("settings", { app_settings: [["main", '{"demoMode":false}', "encrypted-settings", 10]] });
      return { payload: value, records: 1 };
    } }],
    ["local-auth", { domain: "local-auth", path: "domains/local-auth.json", async export() {
      const value = payload("local-auth", { portal_users: [["u1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 0, null, 1, 5, 4]], portal_sessions: [["s1", "u1", "token", 1, 2, 3, "ua"]] });
      return { payload: value, records: 2 };
    } }],
  ]);
}

async function document() {
  return exportEncryptedBackup(
    { DB: {} },
    { domains: ["settings", "local-auth"], password: "strong password", schemaVersion: 1, createdAt: "2026-07-31T09:00:00.000Z", salt, iterations: 210000, ivForDomain },
    registry(),
  );
}

function expectCode(error, code) {
  return error instanceof BackupEncryptedPreviewError && error.code === code;
}

test("validates encrypted envelope integrity before decryption", async () => {
  const original = await document();
  assert.deepEqual(await validateEncryptedBackupDocument(original), original);

  const corrupt = structuredClone(original);
  corrupt.payloads["domains/settings.json"].ciphertext = Buffer.from("changed ciphertext").toString("base64");
  await assert.rejects(validateEncryptedBackupDocument(corrupt), (error) => expectCode(error, "backup_decryption_failed"));

  const extra = structuredClone(original);
  extra.payloads["domains/extra.json"] = extra.payloads["domains/settings.json"];
  await assert.rejects(validateEncryptedBackupDocument(extra), (error) => expectCode(error, "backup_payload_unexpected"));
});

test("decrypts once-derived key and projects plaintext immediately", async () => {
  const original = await document();
  let derives = 0;
  const decrypted = await decryptEncryptedBackupDocument(original, "strong password", {
    async deriveKey(password, sourceSalt, iterations) {
      derives += 1;
      const { deriveBackupKey } = await import("../src/backup/crypto/backup-encryption.ts");
      return deriveBackupKey(password, sourceSalt, iterations);
    },
  });
  assert.equal(derives, 1);
  const badCount = structuredClone(original);
  badCount.manifest.entries[0].records += 1;
  badCount.summary.records += 1;
  await assert.rejects(
    decryptEncryptedBackupDocument(badCount, "strong password"),
    (error) => expectCode(error, "backup_full_payload_invalid"),
  );
  assert.deepEqual(decrypted.payloads["domains/settings.json"], { records: [{ id: "main", config: { demoMode: false }, updated_at: 10 }] });
  assert.deepEqual(decrypted.payloads["domains/local-auth.json"], { records: [{ id: "u1", username: "admin", display_name: "Admin", role: "admin", disabled: 0, created_at: 1, updated_at: 5, last_login_at: 4 }] });
  assert.doesNotMatch(JSON.stringify(decrypted), /encrypted-settings|hash|token/);
});

test("normalizes wrong password and blocks future schema before deriving", async () => {
  const original = await document();
  await assert.rejects(
    decryptEncryptedBackupDocument(original, "wrong password"),
    (error) => expectCode(error, "backup_decryption_failed") && error.message === "Backup decryption failed",
  );

  let derives = 0;
  await assert.rejects(
    previewEncryptedBackupImport({ DB: {} }, original, "strong password", { state: "ready", currentVersion: 0 }, new Map(), {
      async deriveKey() { derives += 1; throw new Error("must not derive"); },
      async preview() { throw new Error("must not preview"); },
    }),
    (error) => expectCode(error, "backup_schema_incompatible"),
  );
  assert.equal(derives, 0);
});

test("passes only safe projected records to existing comparison engine", async () => {
  const original = await document();
  let received;
  const result = await previewEncryptedBackupImport(
    { DB: {} },
    original,
    "strong password",
    { state: "ready", currentVersion: 1, appliedVersions: [1] },
    new Map(),
    {
      fullRegistry: registry(),
      async preview(_env, projected, schema) {
        received = { projected, schema };
        return { selectedDomains: projected.manifest.domains, canRestore: true, summary: { add: 2, update: 0, unchanged: 0, conflict: 0, removeIgnored: 0 }, domains: [], backup: {}, requiredMigrations: [] };
      },
    },
  );
  assert.equal(result.summary.add, 2);
  assert.match(result.restorePlan.approvalToken, /^[0-9a-f]{64}$/);
  assert.equal(received.projected.manifest.mode, "encrypted");
  assert.doesNotMatch(canonicalBackupJson(received.projected.payloads), /encrypted-settings|hash|token/);
});
