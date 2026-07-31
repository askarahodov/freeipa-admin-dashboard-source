import test from "node:test";
import assert from "node:assert/strict";

import { exportEncryptedBackup } from "../backup-encrypted-export.ts";
import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import {
  BackupEncryptedPreviewError,
  decryptEncryptedBackupDocument,
  decryptEncryptedBackupDomains,
  previewEncryptedBackupImport,
} from "../backup-encrypted-preview.ts";

const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
const ivForDomain = (domain) => Buffer.from(Array.from({ length: 12 }, (_, index) => domain.length * 10 + index)).toString("base64");

function payload(domain, rowsByTable) {
  const definitions = FULL_BACKUP_TABLES.find(([item]) => item === domain)[1];
  return {
    domain,
    schemaVersion: 1,
    tables: definitions.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      primaryKey: [...table.primaryKey],
      rows: rowsByTable[table.name] ?? [],
    })),
  };
}

function fullRegistry(settingsSecret = "encrypted-settings") {
  return new Map([
    ["settings", { domain: "settings", path: "domains/settings.json", async export() {
      const value = payload("settings", { app_settings: [["main", '{"demoMode":false}', settingsSecret, 10]] });
      return { payload: value, records: 1 };
    } }],
    ["local-auth", { domain: "local-auth", path: "domains/local-auth.json", async export() {
      const value = payload("local-auth", {
        portal_users: [["u1", "admin", "Admin", "hash", "salt", 210000, "admin", 0, 0, null, 1, 5, 4]],
        portal_sessions: [["s1", "u1", "token", 1, 2, 3, "ua"]],
      });
      return { payload: value, records: 2 };
    } }],
  ]);
}

async function encryptedDocument() {
  return exportEncryptedBackup(
    { DB: {} },
    {
      domains: ["settings", "local-auth"],
      password: "strong password",
      schemaVersion: 1,
      createdAt: "2026-07-31T09:00:00.000Z",
      salt,
      iterations: 210000,
      ivForDomain,
    },
    fullRegistry(),
  );
}

function sanitizedRegistry() {
  return new Map([
    ["settings", { domain: "settings", path: "domains/settings.json", async export() { return { payload: { records: [] }, records: 0 }; } }],
    ["local-auth", { domain: "local-auth", path: "domains/local-auth.json", async export() { return { payload: { records: [] }, records: 0 }; } }],
  ]);
}

test("decrypts and projects only the selected encrypted domains", async () => {
  const original = await encryptedDocument();
  const decryptedDomains = [];
  const selected = await decryptEncryptedBackupDomains(
    original,
    "strong password",
    ["local-auth"],
    {
      async decrypt(input) {
        decryptedDomains.push(input.context.domain);
        const { decryptBackupPayload } = await import("../backup-encryption.ts");
        return decryptBackupPayload(input);
      },
    },
  );

  assert.deepEqual(decryptedDomains, ["local-auth"]);
  assert.deepEqual(selected.selectedDomains, ["local-auth"]);
  assert.deepEqual([...selected.fullPayloads.keys()], ["local-auth"]);
  assert.deepEqual(selected.projected.manifest.domains, ["local-auth"]);
  assert.deepEqual(Object.keys(selected.projected.payloads), ["domains/local-auth.json"]);
  assert.equal(selected.projected.summary.entries, 1);
  assert.equal(selected.projected.summary.records, 2);
  assert.doesNotMatch(JSON.stringify(selected.projected), /hash|token/);
});

test("omitted selection preserves the existing all-domain decryption behavior", async () => {
  const original = await encryptedDocument();
  const legacy = await decryptEncryptedBackupDocument(original, "strong password");
  const selected = await decryptEncryptedBackupDomains(original, "strong password", undefined);
  assert.deepEqual(selected.projected, legacy);
  assert.deepEqual(selected.selectedDomains, ["settings", "local-auth"]);
});

test("preview returns a restore plan bound to the selected domains", async () => {
  const original = await encryptedDocument();
  let comparedDomains;
  const result = await previewEncryptedBackupImport(
    { DB: {} },
    original,
    "strong password",
    { state: "ready", currentVersion: 1, appliedVersions: [1] },
    sanitizedRegistry(),
    {
      fullRegistry: fullRegistry(),
      async preview(_env, projected) {
        comparedDomains = projected.manifest.domains;
        return {
          selectedDomains: projected.manifest.domains,
          canRestore: true,
          summary: { add: 1, update: 0, unchanged: 0, conflict: 0, removeIgnored: 0 },
          domains: [],
          backup: { format: projected.manifest.format, version: 1, createdAt: projected.manifest.createdAt, sourceSchemaVersion: 1, currentSchemaVersion: 1 },
          requiredMigrations: [],
        };
      },
    },
    { selectedDomains: ["settings"] },
  );

  assert.deepEqual(comparedDomains, ["settings"]);
  assert.deepEqual(result.restorePlan.version, 1);
  assert.deepEqual(result.restorePlan.selectedDomains, ["settings"]);
  assert.match(result.restorePlan.approvalToken, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(result.restorePlan), /encrypted-settings|fingerprint|sha256/i);
});

test("rejects a selected domain that is absent from the encrypted manifest", async () => {
  const original = await encryptedDocument();
  await assert.rejects(
    decryptEncryptedBackupDomains(original, "strong password", ["audit"]),
    (error) => error instanceof BackupEncryptedPreviewError
      && error.code === "backup_request_invalid"
      && error.status === 400,
  );
});
