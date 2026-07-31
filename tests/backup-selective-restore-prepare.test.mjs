import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupSelectiveRestorePrepareError,
  prepareSelectiveProductionRestore,
} from "../backup-selective-restore-prepare.ts";

const sourceDocument = { manifest: { format: "source" } };
const recoveryDocument = { manifest: { format: "recovery" } };
const sourcePayload = { domain: "policies", schemaVersion: 1, tables: [] };
const input = {
  operation: "restore",
  document: sourceDocument,
  password: "source-password-value",
  domains: ["policies"],
  approvalToken: "1".repeat(64),
  recoveryPassword: "recovery-password-value",
};
const schema = { state: "ready", currentVersion: 1 };
const isolated = {
  tested: true,
  productionMutated: false,
  selectedDomains: ["policies"],
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  canCommit: true,
  summary: { domains: 1, tables: 3, records: 3, checks: 3, warnings: 0 },
  domains: [],
};
const recovery = {
  document: recoveryDocument,
  bindingHash: "2".repeat(64),
  selectedDomains: ["policies"],
  physicalDomains: ["policies"],
  summary: { domains: 1, tables: 3, records: 3 },
};

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      async testRestore(env, value, receivedSchema) {
        calls.push("test");
        assert.equal(value.document, sourceDocument);
        assert.equal(value.password, input.password);
        assert.deepEqual(value.domains, ["policies"]);
        assert.equal(value.approvalToken, input.approvalToken);
        assert.equal(receivedSchema, schema);
        return isolated;
      },
      async decryptSource(document, password, domains) {
        calls.push("decrypt-source");
        assert.equal(document, sourceDocument);
        assert.equal(password, input.password);
        assert.deepEqual(domains, ["policies"]);
        return {
          selectedDomains: ["policies"],
          fullPayloads: new Map([["policies", sourcePayload]]),
        };
      },
      validateCandidate(policy, payloads) {
        calls.push("validate-candidate");
        assert.deepEqual(policy.selectedDomains, ["policies"]);
        assert.equal(payloads.get("policies"), sourcePayload);
      },
      async createRecovery(env, password, policy) {
        calls.push("recovery-create");
        assert.equal(password, input.recoveryPassword);
        assert.deepEqual(policy.selectedDomains, ["policies"]);
        return recovery;
      },
      async verifyRecovery(env, document, password, policy) {
        calls.push("recovery-verify");
        assert.equal(document, recoveryDocument);
        assert.equal(password, input.recoveryPassword);
        assert.deepEqual(policy.physicalDomains, ["policies"]);
        return {
          verified: true,
          bindingHash: recovery.bindingHash,
          physicalDomains: ["policies"],
          summary: recovery.summary,
          currentFullPayloads: new Map([["policies", sourcePayload]]),
        };
      },
      createSecret() {
        calls.push("secret");
        return "A".repeat(43);
      },
      async hashSecret(secret) {
        assert.equal(secret, "A".repeat(43));
        return "3".repeat(64);
      },
      async createBinding(value) {
        assert.equal(value.sourceApprovalToken, input.approvalToken);
        assert.equal(value.recoveryManifestChecksum, recovery.bindingHash);
        return "4".repeat(64);
      },
      createId() {
        return "restore_11111111-1111-4111-8111-111111111111";
      },
      now() {
        return 1_000;
      },
      async createStage(db, value) {
        calls.push("stage-create");
        assert.equal(value.createdAt, 1_000);
        assert.equal(value.expiresAt, 901_000);
        assert.equal(value.stageSecretHash, "3".repeat(64));
        assert.equal(value.sourceBindingHash, "4".repeat(64));
        assert.equal(value.recoveryBindingHash, "2".repeat(64));
        return { ...value, status: "prepared", completedAt: null };
      },
      ...overrides,
    },
  };
}

test("prepares only after candidate and recovery size validation", async () => {
  const deps = dependencies();
  const result = await prepareSelectiveProductionRestore(
    { DB: {} },
    input,
    schema,
    "admin",
    new Map(),
    new Map(),
    deps.value,
  );
  assert.deepEqual(deps.calls, [
    "test",
    "decrypt-source",
    "validate-candidate",
    "recovery-create",
    "recovery-verify",
    "validate-candidate",
    "secret",
    "stage-create",
  ]);
  assert.equal(result.prepared, true);
  assert.equal(result.productionMutated, false);
  assert.equal(result.stage.id, "restore_11111111-1111-4111-8111-111111111111");
  assert.equal(result.stage.secret, "A".repeat(43));
  assert.equal(result.stage.expiresAt, 901_000);
  assert.equal(result.recovery.document, recoveryDocument);
  assert.deepEqual(result.selectedDomains, ["policies"]);

  const serialized = JSON.stringify(result);
  for (const forbidden of [input.password, input.recoveryPassword, input.approvalToken, "2".repeat(64), "3".repeat(64), "4".repeat(64)]) {
    assert.equal(serialized.includes(forbidden), false, forbidden.slice(0, 8));
  }
});

test("does not create recovery or stage when isolated verification cannot commit", async () => {
  const deps = dependencies({
    async testRestore() {
      deps.calls.push("test");
      return { ...isolated, canCommit: false };
    },
  });
  await assert.rejects(
    () => prepareSelectiveProductionRestore(
      { DB: {} }, input, schema, "admin", new Map(), new Map(), deps.value,
    ),
    (error) => error instanceof BackupSelectiveRestorePrepareError
      && error.code === "backup_restore_commit_failed",
  );
  assert.deepEqual(deps.calls, ["test"]);
});

test("rejects an invalid active-admin candidate before recovery creation", async () => {
  const deps = dependencies({
    validateCandidate() {
      deps.calls.push("validate-candidate");
      throw Object.assign(new Error("secret row detail"), { code: "backup_restore_admin_required" });
    },
  });
  await assert.rejects(
    () => prepareSelectiveProductionRestore(
      { DB: {} }, input, schema, "admin", new Map(), new Map(), deps.value,
    ),
    (error) => error instanceof BackupSelectiveRestorePrepareError
      && error.code === "backup_restore_admin_required"
      && !error.message.includes("secret row"),
  );
  assert.deepEqual(deps.calls, ["test", "decrypt-source", "validate-candidate"]);
});

test("does not persist a stage when recovery creation or verification fails", async () => {
  for (const failureStep of ["create", "verify"]) {
    const deps = dependencies({
      ...(failureStep === "create" ? {
        async createRecovery() {
          deps.calls.push("recovery-create");
          throw Object.assign(new Error("secret detail"), { code: "backup_recovery_point_invalid" });
        },
      } : {
        async verifyRecovery() {
          deps.calls.push("recovery-verify");
          throw Object.assign(new Error("secret detail"), { code: "backup_recovery_point_stale" });
        },
      }),
    });
    await assert.rejects(
      () => prepareSelectiveProductionRestore(
        { DB: {} }, input, schema, "admin", new Map(), new Map(), deps.value,
      ),
      (error) => error instanceof BackupSelectiveRestorePrepareError
        && error.code.startsWith("backup_recovery_point"),
    );
    assert.equal(deps.calls.includes("stage-create"), false);
  }
});

test("rejects malformed input and unavailable schema before dependencies", async () => {
  for (const [value, receivedSchema, code] of [
    [{ ...input, extra: true }, schema, "backup_request_invalid"],
    [{ ...input, operation: "delete" }, schema, "backup_request_invalid"],
    [input, { state: "incompatible", currentVersion: 1 }, "backup_schema_incompatible"],
  ]) {
    const deps = dependencies();
    await assert.rejects(
      () => prepareSelectiveProductionRestore(
        { DB: {} }, value, receivedSchema, "admin", new Map(), new Map(), deps.value,
      ),
      (error) => error instanceof BackupSelectiveRestorePrepareError && error.code === code,
    );
    assert.deepEqual(deps.calls, []);
  }
});
