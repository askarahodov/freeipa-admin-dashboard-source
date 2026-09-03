import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupSelectiveRestoreCommitError,
  commitSelectiveProductionRestore,
} from "../src/backup/restore/backup-selective-restore-commit.ts";
import {
  BackupSelectiveRestorePrepareError,
  prepareSelectiveProductionRestore,
} from "../src/backup/restore/backup-selective-restore-prepare.ts";

const sourceDocument = { manifest: { format: "source" } };
const recoveryDocument = { manifest: { format: "recovery" } };
const sourcePayload = { domain: "policies", schemaVersion: 1, tables: [] };
const currentPayload = { domain: "policies", schemaVersion: 1, tables: [] };
const schema = { state: "ready", currentVersion: 1 };
const isolated = {
  tested: true,
  productionMutated: false,
  selectedDomains: ["policies"],
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  canCommit: true,
  summary: { domains: 1, tables: 0, records: 0, checks: 0, warnings: 0 },
  domains: [],
};
const sourceInput = {
  operation: "restore",
  document: sourceDocument,
  password: "source-password-value",
  domains: ["policies"],
  approvalToken: "1".repeat(64),
  recoveryPassword: "recovery-password-value",
};
const stage = {
  id: "restore_11111111-1111-4111-8111-111111111111",
  operation: "restore",
  actorIdentity: "admin",
  selectedDomains: ["policies"],
  stageSecretHash: "3".repeat(64),
  sourceBindingHash: "4".repeat(64),
  recoveryBindingHash: "2".repeat(64),
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  status: "prepared",
  createdAt: 1_000,
  expiresAt: 901_000,
  completedAt: null,
};

function tooLargeError() {
  return Object.assign(new Error("raw oversized row detail"), {
    code: "backup_restore_commit_too_large",
  });
}

test("prepare rejects an oversized recovery state before issuing a stage secret", async () => {
  let validations = 0;
  let secretCalls = 0;
  let stageCalls = 0;
  const dependencies = {
    async testRestore() { return isolated; },
    async decryptSource() {
      return {
        selectedDomains: ["policies"],
        fullPayloads: new Map([["policies", sourcePayload]]),
      };
    },
    validateCandidate() {
      validations += 1;
      if (validations === 2) throw tooLargeError();
    },
    async createRecovery() {
      return {
        document: recoveryDocument,
        bindingHash: stage.recoveryBindingHash,
        selectedDomains: ["policies"],
        physicalDomains: ["policies"],
        summary: { domains: 1, tables: 0, records: 0 },
      };
    },
    async verifyRecovery() {
      return {
        verified: true,
        bindingHash: stage.recoveryBindingHash,
        physicalDomains: ["policies"],
        summary: { domains: 1, tables: 0, records: 0 },
        currentFullPayloads: new Map([["policies", currentPayload]]),
      };
    },
    createSecret() { secretCalls += 1; return "A".repeat(43); },
    async hashSecret() { return stage.stageSecretHash; },
    async createBinding() { return stage.sourceBindingHash; },
    createId() { return stage.id; },
    now() { return stage.createdAt; },
    async createStage() { stageCalls += 1; return stage; },
  };

  await assert.rejects(
    () => prepareSelectiveProductionRestore(
      { DB: {} }, sourceInput, schema, "admin", new Map(), new Map(), dependencies,
    ),
    (error) => error instanceof BackupSelectiveRestorePrepareError
      && error.code === "backup_restore_commit_too_large"
      && error.status === 422
      && !error.message.includes("raw oversized"),
  );
  assert.equal(validations, 2);
  assert.equal(secretCalls, 0);
  assert.equal(stageCalls, 0);
});

test("commit normalizes an oversized D1 plan to a safe 422 before batch", async () => {
  let batchCalls = 0;
  const db = {
    async batch() { batchCalls += 1; return []; },
  };
  const input = {
    ...sourceInput,
    recoveryDocument,
    stageId: stage.id,
    stageSecret: "A".repeat(43),
    acknowledgeRecoverySaved: true,
    confirmation: `RESTORE:${stage.id}`,
  };
  const dependencies = {
    now() { return 10_000; },
    async loadStage() { return stage; },
    async verifySecret() { return true; },
    async testRestore() { return isolated; },
    async verifyRecovery() {
      return {
        verified: true,
        bindingHash: stage.recoveryBindingHash,
        physicalDomains: ["policies"],
        summary: { domains: 1, tables: 0, records: 0 },
        currentFullPayloads: new Map([["policies", currentPayload]]),
      };
    },
    verifyBinding() { return true; },
    async createBinding() { return stage.sourceBindingHash; },
    async decryptSource() {
      return {
        selectedDomains: ["policies"],
        fullPayloads: new Map([["policies", sourcePayload]]),
      };
    },
    validateCandidate() {},
    buildStatements() { throw tooLargeError(); },
    createAuditId() { return "audit-size-test"; },
    createCorrelationId() { return "correlation-size-test"; },
  };

  await assert.rejects(
    () => commitSelectiveProductionRestore(
      { DB: db }, input, schema, "admin", new Map(), new Map(), dependencies,
    ),
    (error) => error instanceof BackupSelectiveRestoreCommitError
      && error.code === "backup_restore_commit_too_large"
      && error.status === 422
      && !error.message.includes("raw oversized"),
  );
  assert.equal(batchCalls, 0);
});
