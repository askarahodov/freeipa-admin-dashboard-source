import test from "node:test";
import assert from "node:assert/strict";

import { exportEncryptedBackup } from "../backup-encrypted-export.ts";
import { FULL_BACKUP_TABLES } from "../backup-full-domains.ts";
import { createBackupRestorePlan } from "../src/backup/restore/backup-restore-plan.ts";
import {
  BackupIsolatedRestoreError,
  testRestoreEncryptedBackupImport,
} from "../backup-isolated-restore.ts";

const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString("base64");
const iv = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 20)).toString("base64");

function payload(secret = "encrypted-a") {
  const definitions = FULL_BACKUP_TABLES.find(([domain]) => domain === "settings")[1];
  return {
    domain: "settings",
    schemaVersion: 1,
    tables: definitions.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      primaryKey: [...table.primaryKey],
      rows: table.name === "app_settings" ? [["main", '{"demoMode":false}', secret, 1]] : [],
    })),
  };
}

function fullRegistry(secret = "encrypted-a") {
  return new Map([["settings", {
    domain: "settings",
    path: "domains/settings.json",
    async export() { return { payload: payload(secret), records: 1 }; },
  }]]);
}

function sanitizedRegistry() {
  return new Map([["settings", {
    domain: "settings",
    path: "domains/settings.json",
    async export() { return { payload: { records: [] }, records: 0 }; },
  }]]);
}

async function encryptedDocument() {
  return exportEncryptedBackup(
    { DB: {} },
    {
      domains: ["settings"],
      password: "strong password",
      schemaVersion: 1,
      createdAt: "2026-07-31T09:00:00.000Z",
      salt,
      iterations: 210000,
      ivForDomain: () => iv,
    },
    fullRegistry(),
  );
}

async function input(overrides = {}) {
  const document = await encryptedDocument();
  const plan = await createBackupRestorePlan({ DB: {} }, document, ["settings"], 1, fullRegistry());
  return {
    document,
    password: "strong password",
    domains: ["settings"],
    approvalToken: plan.approvalToken,
    ...overrides,
  };
}

const schema = { state: "ready", currentVersion: 1, appliedVersions: [1] };

test("stages and verifies an encrypted backup only in isolated memory", async () => {
  const result = await testRestoreEncryptedBackupImport(
    { DB: {} },
    await input(),
    schema,
    sanitizedRegistry(),
    fullRegistry(),
  );

  assert.equal(result.tested, true);
  assert.equal(result.productionMutated, false);
  assert.deepEqual(result.selectedDomains, ["settings"]);
  assert.equal(result.sourceSchemaVersion, 1);
  assert.equal(result.currentSchemaVersion, 1);
  assert.equal(result.canCommit, true);
  assert.deepEqual(result.summary, { tables: 5, records: 1, checks: 5, warnings: 0 });
  assert.doesNotMatch(JSON.stringify(result), /approvalToken|encrypted-a|fingerprint|sha256|password/i);
});

test("rejects stale current state before decryption and isolated store creation", async () => {
  let decrypts = 0;
  let stores = 0;
  await assert.rejects(
    testRestoreEncryptedBackupImport(
      { DB: {} },
      await input(),
      schema,
      sanitizedRegistry(),
      fullRegistry("encrypted-b"),
      {
        async decryptDomains() { decrypts += 1; throw new Error("must not decrypt"); },
        stageStore() { stores += 1; throw new Error("must not stage"); },
      },
    ),
    (error) => error instanceof BackupIsolatedRestoreError
      && error.code === "backup_restore_stale"
      && error.status === 409,
  );
  assert.equal(decrypts, 0);
  assert.equal(stores, 0);
});

test("binds the approval token to domain selection and current schema", async () => {
  const original = await input();
  for (const candidate of [
    { ...original, domains: [] },
    { ...original, domains: ["audit"] },
  ]) {
    await assert.rejects(
      testRestoreEncryptedBackupImport({ DB: {} }, candidate, schema, sanitizedRegistry(), fullRegistry()),
      (error) => error instanceof BackupIsolatedRestoreError
        && error.code === "backup_request_invalid",
    );
  }

  await assert.rejects(
    testRestoreEncryptedBackupImport(
      { DB: {} },
      original,
      { state: "ready", currentVersion: 2, appliedVersions: [1, 2] },
      sanitizedRegistry(),
      fullRegistry(),
    ),
    (error) => error instanceof BackupIsolatedRestoreError
      && error.code === "backup_restore_stale",
  );
});

test("preserves normalized decryption and schema failures", async () => {
  await assert.rejects(
    testRestoreEncryptedBackupImport(
      { DB: {} },
      await input({ password: "wrong password" }),
      schema,
      sanitizedRegistry(),
      fullRegistry(),
    ),
    (error) => error instanceof BackupIsolatedRestoreError
      && error.code === "backup_decryption_failed"
      && error.status === 422,
  );

  await assert.rejects(
    testRestoreEncryptedBackupImport(
      { DB: {} },
      await input(),
      { state: "blocked", currentVersion: 1 },
      sanitizedRegistry(),
      fullRegistry(),
    ),
    (error) => error instanceof BackupIsolatedRestoreError
      && error.code === "backup_schema_incompatible"
      && error.status === 409,
  );
});
