import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfflineMaintenanceRecoveryScript,
  recoverFailedMaintenanceOffline,
} from "../recovery-maintenance.ts";

const maintenanceOperationId = "maintenance_11111111-1111-4111-8111-111111111111";
const recoveryHash = "a".repeat(64);

function receipt(overrides = {}) {
  return {
    format: "portal-offline-recovery-receipt",
    version: 1,
    operationId: "recovery_22222222-2222-4222-8222-222222222222",
    createdAt: "2026-08-04T08:00:00.000Z",
    updatedAt: "2026-08-04T08:03:00.000Z",
    phase: "swapped",
    liveDatabaseRelativePath: "state/v3/d1/live.sqlite",
    liveDatabaseSha256: "b".repeat(64),
    liveDatabaseBytes: 4096,
    schemaVersion: 3,
    maintenanceOperationId,
    backupManifestSha256: "c".repeat(64),
    recoveryPointRelativePath: "points/original.sqlite.enc",
    recoveryPointSha256: recoveryHash,
    recoveryPointBytes: 8192,
    candidateRelativePath: "state/v3/d1/candidate.sqlite",
    candidateSha256: "d".repeat(64),
    candidateBytes: 4096,
    rollbackRelativePath: "state/v3/d1/rollback.sqlite",
    confirmation: "RESTORE PORTAL DATABASE recovery_22222222-2222-4222-8222-222222222222",
    checks: {
      checkpoint: "ok",
      sourceIntegrity: "ok",
      encryptedRoundTrip: "ok",
      recoveryPointIntegrity: "ok",
      candidateIntegrity: "ok",
      candidateSchema: "ok",
      candidateAdministrator: "ok",
      candidateEncryption: "ok",
      candidateAudit: "ok",
      swap: "ok",
    },
    ...overrides,
  };
}

test("builds one bounded transaction for state reset session purge and audit", () => {
  const script = buildOfflineMaintenanceRecoveryScript({
    maintenanceOperationId,
    auditId: "audit-1",
    now: 1_754_302_000_000,
  });
  assert.match(script, /^PRAGMA foreign_keys = ON;\nBEGIN IMMEDIATE;/u);
  assert.match(script, /UPDATE portal_maintenance_state/u);
  assert.match(script, /state IN \('active','verifying','exiting','failed'\)/u);
  assert.match(script, /DELETE FROM portal_sessions;/u);
  assert.match(script, /INSERT INTO portal_audit_events/u);
  assert.match(script, /portal\.maintenance\.offline_recovered/u);
  assert.match(script, /COMMIT;\n$/u);
  assert.doesNotMatch(script, /password|controllerSecret|configEncryptionKey/u);
});

test("recovers failed maintenance only after every offline check", async () => {
  const calls = [];
  const result = await recoverFailedMaintenanceOffline({
    receipt: receipt(),
    databasePath: "/data/live.sqlite",
    recoveryPointPath: "/artifacts/points/original.sqlite.enc",
    confirmation: `RECOVER FAILED MAINTENANCE ${maintenanceOperationId}`,
    administratorUsername: "admin",
    administratorPassword: "correct horse battery staple",
    configEncryptionKey: "1".repeat(64),
    now: 1_754_302_000_000,
  }, {
    async fingerprint(path) {
      calls.push(`fingerprint:${path}`);
      return { sha256: recoveryHash, bytes: 8192 };
    },
    async verifyIntegrity(path) { calls.push(`integrity:${path}`); return { integrity: "ok" }; },
    async inspectSchema(path) { calls.push(`schema:${path}`); return { state: "ready", currentVersion: 3 }; },
    async loadMaintenance(path) {
      calls.push(`maintenance:${path}`);
      return { state: "failed", operationId: maintenanceOperationId, controllerSecretHash: "e".repeat(64) };
    },
    async verifyAdministrator(path, username, password, now) {
      calls.push("administrator");
      assert.equal(path, "/data/live.sqlite");
      assert.equal(username, "admin");
      assert.equal(password, "correct horse battery staple");
      assert.equal(now, 1_754_302_000_000);
      return { administratorAccess: "ok" };
    },
    async verifySettings(path, key) {
      calls.push("settings");
      assert.equal(path, "/data/live.sqlite");
      assert.equal(key, "1".repeat(64));
      return { settingsDecryption: "ok" };
    },
    async runTransaction(path, script) {
      calls.push("transaction");
      assert.equal(path, "/data/live.sqlite");
      assert.match(script, /BEGIN IMMEDIATE;/u);
      return { changed: 1 };
    },
    async verifyResult(path) {
      calls.push("result");
      assert.equal(path, "/data/live.sqlite");
      return { state: "inactive", sessions: 0, auditEvents: 1 };
    },
  });
  assert.deepEqual(result, {
    state: "inactive",
    operationId: maintenanceOperationId,
    checks: {
      recoveryPoint: "ok",
      integrity: "ok",
      schema: "ok",
      administratorAccess: "ok",
      settingsDecryption: "ok",
      auditWrite: "ok",
      sessionsRevoked: "ok",
    },
  });
  assert.deepEqual(calls, [
    "fingerprint:/artifacts/points/original.sqlite.enc",
    "integrity:/data/live.sqlite",
    "schema:/data/live.sqlite",
    "maintenance:/data/live.sqlite",
    "administrator",
    "settings",
    "transaction",
    "result",
  ]);
});

test("rejects wrong confirmation before filesystem or credential checks", async () => {
  let touched = false;
  await assert.rejects(
    recoverFailedMaintenanceOffline({
      receipt: receipt(),
      databasePath: "/data/live.sqlite",
      recoveryPointPath: "/artifacts/recovery.enc",
      confirmation: "RECOVER FAILED MAINTENANCE wrong",
      administratorUsername: "admin",
      administratorPassword: "password",
      configEncryptionKey: "1".repeat(64),
    }, {
      async fingerprint() { touched = true; throw new Error("unreachable"); },
    }),
    (error) => error.code === "recovery_maintenance_confirmation_invalid",
  );
  assert.equal(touched, false);
});

test("rejects unrelated maintenance state and mismatched recovery point", async () => {
  for (const mode of ["state", "point"]) {
    let transaction = false;
    await assert.rejects(
      recoverFailedMaintenanceOffline({
        receipt: receipt(),
        databasePath: "/data/live.sqlite",
        recoveryPointPath: "/artifacts/recovery.enc",
        confirmation: `RECOVER FAILED MAINTENANCE ${maintenanceOperationId}`,
        administratorUsername: "admin",
        administratorPassword: "password",
        configEncryptionKey: "1".repeat(64),
      }, {
        async fingerprint() {
          return { sha256: mode === "point" ? "f".repeat(64) : recoveryHash, bytes: 8192 };
        },
        async verifyIntegrity() { return { integrity: "ok" }; },
        async inspectSchema() { return { state: "ready", currentVersion: 3 }; },
        async loadMaintenance() {
          return {
            state: mode === "state" ? "inactive" : "failed",
            operationId: maintenanceOperationId,
            controllerSecretHash: null,
          };
        },
        async verifyAdministrator() { return { administratorAccess: "ok" }; },
        async verifySettings() { return { settingsDecryption: "ok" }; },
        async runTransaction() { transaction = true; return { changed: 1 }; },
        async verifyResult() { return { state: "inactive", sessions: 0, auditEvents: 1 }; },
      }),
      (error) => ["recovery_point_binding_invalid", "recovery_maintenance_state_invalid"].includes(error.code),
    );
    assert.equal(transaction, false);
  }
});

test("transaction failure leaves recovery fail-closed and hides raw details", async () => {
  await assert.rejects(
    recoverFailedMaintenanceOffline({
      receipt: receipt(),
      databasePath: "/data/live.sqlite",
      recoveryPointPath: "/artifacts/recovery.enc",
      confirmation: `RECOVER FAILED MAINTENANCE ${maintenanceOperationId}`,
      administratorUsername: "admin",
      administratorPassword: "secret-password",
      configEncryptionKey: "1".repeat(64),
    }, {
      async fingerprint() { return { sha256: recoveryHash, bytes: 8192 }; },
      async verifyIntegrity() { return { integrity: "ok" }; },
      async inspectSchema() { return { state: "ready", currentVersion: 3 }; },
      async loadMaintenance() { return { state: "failed", operationId: maintenanceOperationId, controllerSecretHash: null }; },
      async verifyAdministrator() { return { administratorAccess: "ok" }; },
      async verifySettings() { return { settingsDecryption: "ok" }; },
      async runTransaction() { throw new Error("raw secret-password sqlite detail"); },
      async verifyResult() { throw new Error("unreachable"); },
    }),
    (error) => error.code === "recovery_maintenance_failed" && !/secret-password|sqlite detail/u.test(error.message),
  );
});
