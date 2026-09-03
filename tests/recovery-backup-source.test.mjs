import assert from "node:assert/strict";
import test from "node:test";

import { exportEncryptedBackup } from "../src/backup/export/backup-encrypted-export.ts";
import { FULL_BACKUP_TABLES } from "../src/backup/export/backup-full-domains.ts";
import { PORTAL_BACKUP_DOMAINS } from "../src/backup/backup-manifest.ts";
import {
  loadFullRestoreSource,
  verifyBackupAdministrator,
} from "../src/recovery/foundation/recovery-backup-source.ts";
import { resolveRecoverySchemaAdapter } from "../src/recovery/adapters/recovery-schema-adapters.ts";

const backupPassword = "offline backup password";
const administratorPassword = "administrator password";
const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
const ivForDomain = (domain) => Buffer.from(Array.from({ length: 12 }, (_, index) => domain.length * 11 + index)).toString("base64");

async function passwordCredentials(password) {
  const saltBytes = Buffer.from(Array.from({ length: 24 }, (_, index) => index + 21));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 210_000 }, material, 256);
  return {
    hash: Buffer.from(bits).toString("base64"),
    salt: saltBytes.toString("base64"),
    iterations: 210_000,
  };
}

function payload(domain, schemaVersion, rowsByTable = {}) {
  const definitions = FULL_BACKUP_TABLES.find(([item]) => item === domain)?.[1];
  assert.ok(definitions, `missing definitions for ${domain}`);
  return {
    domain,
    schemaVersion,
    tables: definitions.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      primaryKey: [...table.primaryKey],
      rows: rowsByTable[table.name] ?? [],
    })),
  };
}

async function registry(schemaVersion = 3) {
  const credentials = await passwordCredentials(administratorPassword);
  const rows = {
    "local-auth": {
      portal_users: [[
        "user-admin",
        "admin",
        "Administrator",
        credentials.hash,
        credentials.salt,
        credentials.iterations,
        "admin",
        0,
        0,
        null,
        1_000,
        2_000,
        null,
      ]],
      portal_sessions: [["old-session", "user-admin", "old-token-hash", 1_000, 1_100, 9_999_999, "old-browser"]],
    },
    rbac: {
      portal_role_assignments: [["user-admin", "admin", "admin", 0, 2_000]],
    },
  };
  return new Map(PORTAL_BACKUP_DOMAINS.map((domain) => [domain, {
    domain,
    path: `domains/${domain}.json`,
    async export() {
      const value = payload(domain, schemaVersion, rows[domain]);
      return {
        payload: value,
        records: value.tables.reduce((total, table) => total + table.rows.length, 0),
      };
    },
  }]));
}

async function document(domains = [...PORTAL_BACKUP_DOMAINS], schemaVersion = 3) {
  return exportEncryptedBackup(
    { DB: {} },
    {
      domains,
      password: backupPassword,
      schemaVersion,
      createdAt: "2026-08-04T08:00:00.000Z",
      salt,
      iterations: 210_000,
      ivForDomain,
    },
    await registry(schemaVersion),
  );
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error && error.code === code && !String(error.message).includes(backupPassword),
  );
}

test("loads a complete encrypted backup into immutable full restore source metadata", async () => {
  const original = await document();
  const source = await loadFullRestoreSource(original, backupPassword);

  assert.match(source.manifestSha256, /^[a-f0-9]{64}$/u);
  assert.equal(source.sourceSchemaVersion, 3);
  assert.deepEqual(source.domains, [...PORTAL_BACKUP_DOMAINS]);
  assert.equal(source.payloads.size, PORTAL_BACKUP_DOMAINS.length);
  assert.equal(source.tableCounts.portal_users, 1);
  assert.equal(source.tableCounts.portal_sessions, 1);
  assert.equal(source.tableCounts.portal_role_assignments, 1);
  assert.equal(source.totalRecords, 3);
  assert.ok(source.documentBytes > 0);
  assert.equal(Object.isFrozen(source.domains), true);
  assert.equal(Object.isFrozen(source.tableCounts), true);
});

test("destructive restore rejects partial, sanitized and noncanonical domain documents", async () => {
  await expectCode(
    loadFullRestoreSource(await document(["settings", "local-auth"]), backupPassword),
    "recovery_full_backup_required",
  );

  const sanitized = await document();
  sanitized.manifest.mode = "sanitized";
  sanitized.manifest.encryption = null;
  await expectCode(loadFullRestoreSource(sanitized, backupPassword), "recovery_full_backup_required");

  const noncanonical = await document();
  noncanonical.manifest.domains = [...noncanonical.manifest.domains].reverse();
  await expectCode(loadFullRestoreSource(noncanonical, backupPassword), "recovery_full_backup_required");
});

test("wrong password, checksum damage and ciphertext damage share one safe error", async () => {
  const original = await document();
  await expectCode(loadFullRestoreSource(original, "wrong password value"), "recovery_backup_decryption_failed");

  const checksumDamage = structuredClone(original);
  checksumDamage.manifest.entries[0].sha256 = "0".repeat(64);
  await expectCode(loadFullRestoreSource(checksumDamage, backupPassword), "recovery_backup_decryption_failed");

  const ciphertextDamage = structuredClone(original);
  ciphertextDamage.payloads["domains/settings.json"].ciphertext = Buffer.from("damaged ciphertext").toString("base64");
  await expectCode(loadFullRestoreSource(ciphertextDamage, backupPassword), "recovery_backup_decryption_failed");
});

test("verifies only enabled unlocked administrators with the exact password contract", async () => {
  const source = await loadFullRestoreSource(await document(), backupPassword);
  assert.deepEqual(await verifyBackupAdministrator(source, "admin", administratorPassword, 5_000), {
    userId: "user-admin",
    username: "admin",
  });
  await expectCode(
    verifyBackupAdministrator(source, "admin", "wrong administrator password", 5_000),
    "recovery_administrator_invalid",
  );
  await expectCode(
    verifyBackupAdministrator(source, "missing", administratorPassword, 5_000),
    "recovery_administrator_invalid",
  );
});

test("schema adapters are explicit for supported v2/v3 sources", async () => {
  const sourceV2 = await loadFullRestoreSource(await document(undefined, 2), backupPassword);
  const sourceV3 = await loadFullRestoreSource(await document(undefined, 3), backupPassword);
  const adapterV2 = resolveRecoverySchemaAdapter(2, 3);
  const adapterV3 = resolveRecoverySchemaAdapter(3, 3);

  assert.deepEqual(adapterV2.transform(sourceV2), sourceV2);
  assert.deepEqual(adapterV3.transform(sourceV3), sourceV3);
  assert.equal(adapterV2.sourceVersion, 2);
  assert.equal(adapterV2.currentVersion, 3);
  assert.equal(adapterV3.sourceVersion, 3);
  assert.equal(adapterV3.currentVersion, 3);

  assert.throws(
    () => resolveRecoverySchemaAdapter(1, 3),
    (error) => error.code === "recovery_schema_adapter_unavailable",
  );
  assert.throws(
    () => resolveRecoverySchemaAdapter(4, 3),
    (error) => error.code === "recovery_schema_newer_than_runtime",
  );
});
