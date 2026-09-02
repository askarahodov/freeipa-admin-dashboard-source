import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupSelectiveRecoveryPointError,
  createSelectiveRecoveryPoint,
  verifySelectiveRecoveryPoint,
} from "../backup-selective-recovery-point.ts";
import { validateSelectiveRestoreDomains } from "../src/backup/restore/backup-selective-restore-policy.ts";

const manifest = {
  format: "freeipa-admin-dashboard-backup",
  version: 1,
  createdAt: "2026-07-31T12:00:00.000Z",
  schemaVersion: 1,
  mode: "encrypted",
  domains: ["policies"],
  entries: [{
    domain: "policies",
    path: "domains/policies.json",
    sha256: "1".repeat(64),
    bytes: 100,
    records: 3,
  }],
  encryption: {
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: 210000,
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  },
};
const document = {
  manifest,
  payloads: {
    "domains/policies.json": { iv: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==" },
  },
  summary: { entries: 1, records: 3, bytes: 100 },
};
const policiesPayload = {
  domain: "policies",
  schemaVersion: 1,
  tables: [
    {
      name: "catalog_visibility_policies",
      columns: ["id", "policy_json", "updated_at"],
      primaryKey: ["id"],
      rows: [["visibility", "{}", 1]],
    },
    {
      name: "approval_policy_sets",
      columns: ["id", "policy_json", "updated_at"],
      primaryKey: ["id"],
      rows: [["approval", "{}", 1]],
    },
    {
      name: "process_presentation_sets",
      columns: ["id", "metadata_json", "updated_at"],
      primaryKey: ["id"],
      rows: [["presentation", "{}", 1]],
    },
  ],
};

function registry(payload = policiesPayload) {
  return new Map([["policies", {
    domain: "policies",
    path: "domains/policies.json",
    async export() {
      return { payload, records: payload.tables.reduce((sum, table) => sum + table.rows.length, 0) };
    },
  }]]);
}

test("creates an encrypted recovery point for physical domains only", async () => {
  const calls = [];
  const policy = validateSelectiveRestoreDomains(["local-auth", "rbac", "policies"]);
  const result = await createSelectiveRecoveryPoint(
    { DB: {} },
    "recovery-password-value",
    policy,
    1,
    new Map(),
    {
      async exportDocument(env, options, fullRegistry) {
        calls.push({ env, options, fullRegistry });
        return {
          ...document,
          manifest: { ...manifest, domains: ["local-auth", "policies"] },
          summary: { entries: 2, records: 4, bytes: 200 },
        };
      },
    },
  );
  assert.deepEqual(calls[0].options.domains, ["local-auth", "policies"]);
  assert.equal(calls[0].options.password, "recovery-password-value");
  assert.equal(result.document.summary.records, 4);
  assert.deepEqual(result.selectedDomains, ["local-auth", "rbac", "policies"]);
  assert.deepEqual(result.physicalDomains, ["local-auth", "policies"]);
  assert.match(result.bindingHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes("recovery-password-value"), false);
});

test("verifies a recovery point against a fresh canonical full-state export", async () => {
  const result = await verifySelectiveRecoveryPoint(
    { DB: {} },
    document,
    "recovery-password-value",
    validateSelectiveRestoreDomains(["policies"]),
    1,
    registry(),
    {
      async validateDocument(value) {
        assert.equal(value, document);
        return document;
      },
      async decryptDomains(value, password, domains) {
        assert.equal(value, document);
        assert.equal(password, "recovery-password-value");
        assert.deepEqual(domains, ["policies"]);
        return {
          document,
          selectedDomains: ["policies"],
          fullPayloads: new Map([["policies", policiesPayload]]),
          projected: {},
        };
      },
    },
  );
  assert.equal(result.verified, true);
  assert.deepEqual(result.physicalDomains, ["policies"]);
  assert.deepEqual(result.summary, { domains: 1, tables: 3, records: 3 });
  assert.match(result.bindingHash, /^[0-9a-f]{64}$/);
});

test("rejects a stale recovery point when any full-state field changes", async () => {
  const changed = structuredClone(policiesPayload);
  changed.tables[0].rows[0][1] = "{\"changed\":true}";
  await assert.rejects(
    () => verifySelectiveRecoveryPoint(
      { DB: {} },
      document,
      "recovery-password-value",
      validateSelectiveRestoreDomains(["policies"]),
      1,
      registry(changed),
      {
        async validateDocument() { return document; },
        async decryptDomains() {
          return {
            document,
            selectedDomains: ["policies"],
            fullPayloads: new Map([["policies", policiesPayload]]),
            projected: {},
          };
        },
      },
    ),
    (error) => error instanceof BackupSelectiveRecoveryPointError
      && error.code === "backup_recovery_point_stale"
      && !String(error.message).includes("changed"),
  );
});

test("rejects missing, extra, logical or incompatible recovery domains", async () => {
  for (const invalidDocument of [
    { ...document, manifest: { ...manifest, domains: [] } },
    { ...document, manifest: { ...manifest, domains: ["policies", "catalog"] } },
    { ...document, manifest: { ...manifest, domains: ["rbac"] } },
    { ...document, manifest: { ...manifest, schemaVersion: 2 } },
  ]) {
    await assert.rejects(
      () => verifySelectiveRecoveryPoint(
        { DB: {} },
        invalidDocument,
        "recovery-password-value",
        validateSelectiveRestoreDomains(["policies"]),
        1,
        registry(),
        {
          async validateDocument() { return invalidDocument; },
          async decryptDomains() { throw new Error("must not decrypt"); },
        },
      ),
      (error) => error instanceof BackupSelectiveRecoveryPointError
        && ["backup_recovery_point_invalid", "backup_schema_incompatible"].includes(error.code),
    );
  }
});
