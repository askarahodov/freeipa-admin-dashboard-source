import assert from "node:assert/strict";
import test from "node:test";

import { PORTAL_BACKUP_DOMAINS } from "../src/backup/backup-manifest.ts";
import { runRecoveryPreflight } from "../src/recovery/orchestration/recovery-preflight.ts";

const databaseSha256 = "a".repeat(64);
const manifestSha256 = "b".repeat(64);
const controllerSecret = "controller-secret-value";
const controllerHash = "controller-hash-value";
const backupPassword = "backup-password-value";
const administratorPassword = "administrator-password-value";
const configKey = "config-encryption-key-value";

function source() {
  return {
    manifestSha256,
    sourceSchemaVersion: 3,
    domains: Object.freeze([...PORTAL_BACKUP_DOMAINS]),
    payloads: new Map(),
    tableCounts: Object.freeze({ portal_users: 1, portal_sessions: 1 }),
    totalRecords: 2,
    documentBytes: 2_048,
  };
}

function dependencies(overrides = {}) {
  const calls = [];
  const base = {
    calls,
    resolveRoots(input) {
      calls.push("roots");
      return { ...input };
    },
    async probeLock(path) {
      calls.push("lock");
      assert.equal(path, "/data/.portal-exclusive.lock");
      return { available: true };
    },
    async discoverDatabase(input) {
      calls.push("database");
      assert.equal(input.dataRoot, "/data");
      return "/data/state/v3/d1/opaque-db";
    },
    async fingerprintFile(path) {
      calls.push("fingerprint");
      assert.equal(path, "/data/state/v3/d1/opaque-db");
      return { sha256: databaseSha256, bytes: 1_024 };
    },
    async inspectCurrentDatabase(path) {
      calls.push("schema");
      assert.equal(path, "/data/state/v3/d1/opaque-db");
      return { state: "ready", currentVersion: 3 };
    },
    async loadMaintenance(path) {
      calls.push("maintenance");
      assert.equal(path, "/data/state/v3/d1/opaque-db");
      return {
        state: "active",
        operationId: "maintenance_11111111-1111-4111-8111-111111111111",
        controllerSecretHash: controllerHash,
      };
    },
    async verifyControllerSecret(secret, hash) {
      calls.push("controller");
      return secret === controllerSecret && hash === controllerHash;
    },
    async loadSource(document, password) {
      calls.push("backup");
      assert.deepEqual(document, { encrypted: true });
      assert.equal(password, backupPassword);
      return source();
    },
    resolveAdapter(sourceVersion, currentVersion) {
      calls.push("adapter");
      return {
        sourceVersion,
        currentVersion,
        transform(value) { return value; },
      };
    },
    async verifyAdministrator(value, username, password, now) {
      calls.push("administrator");
      assert.equal(value.manifestSha256, manifestSha256);
      assert.equal(username, "admin");
      assert.equal(password, administratorPassword);
      assert.equal(now, 10_000);
      return { userId: "user-admin", username: "admin" };
    },
    async verifyEncryptedMaterial(value, key) {
      calls.push("encryption");
      assert.equal(value.manifestSha256, manifestSha256);
      assert.equal(key, configKey);
      return { settings: "ok", replays: "ok", approvals: "ok" };
    },
    async statDiskSpace(root) {
      calls.push(`space:${root}`);
      return { availableBytes: root === "/data" ? 10_000 : 20_000 };
    },
  };
  return Object.assign(base, overrides);
}

function input() {
  return {
    dataRoot: "/data",
    artifactRoot: "/artifacts",
    secretsRoot: "/secrets",
    lockPath: "/data/.portal-exclusive.lock",
    backupDocument: { encrypted: true },
    backupPassword,
    controllerSecret,
    administratorUsername: "admin",
    administratorPassword,
    configEncryptionKey: configKey,
    now: 10_000,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error && error.code === code && !String(error.message).includes("value"),
  );
}

test("returns only aggregate immutable preflight evidence in fail-closed order", async () => {
  const deps = dependencies();
  const result = await runRecoveryPreflight(input(), deps);

  assert.deepEqual(deps.calls, [
    "roots",
    "lock",
    "database",
    "fingerprint",
    "schema",
    "maintenance",
    "controller",
    "backup",
    "adapter",
    "administrator",
    "encryption",
    "space:/data",
    "space:/artifacts",
  ]);
  assert.deepEqual(result, {
    checks: {
      roots: "ok",
      lock: "ok",
      database: "ok",
      schema: "ok",
      maintenance: "ok",
      controller: "ok",
      backup: "ok",
      administrator: "ok",
      encryption: "ok",
      diskSpace: "ok",
    },
    database: {
      relativePath: "state/v3/d1/opaque-db",
      sha256: databaseSha256,
      bytes: 1_024,
      schemaVersion: 3,
    },
    maintenance: {
      state: "active",
      operationId: "maintenance_11111111-1111-4111-8111-111111111111",
    },
    backup: {
      manifestSha256,
      sourceSchemaVersion: 3,
      domains: PORTAL_BACKUP_DOMAINS.length,
      tables: 2,
      records: 2,
      documentBytes: 2_048,
    },
    adapter: {
      sourceVersion: 3,
      currentVersion: 3,
    },
    space: {
      dataAvailableBytes: 10_000,
      artifactAvailableBytes: 20_000,
      dataRequiredBytes: 2_048,
      artifactRequiredBytes: 4_096,
    },
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [controllerSecret, controllerHash, backupPassword, administratorPassword, configKey, "user-admin"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.checks), true);
});

test("rejects a busy runtime lock before database discovery", async () => {
  const deps = dependencies({ async probeLock() { deps.calls.push("lock"); return { available: false }; } });
  await expectCode(runRecoveryPreflight(input(), deps), "recovery_lock_busy");
  assert.deepEqual(deps.calls, ["roots", "lock"]);
});

test("requires ready schema and active or verifying maintenance", async () => {
  const schemaDeps = dependencies({ async inspectCurrentDatabase() { schemaDeps.calls.push("schema"); return { state: "blocked", currentVersion: 3 }; } });
  await expectCode(runRecoveryPreflight(input(), schemaDeps), "recovery_schema_not_ready");
  assert.equal(schemaDeps.calls.includes("backup"), false);

  const maintenanceDeps = dependencies({ async loadMaintenance() { maintenanceDeps.calls.push("maintenance"); return { state: "inactive", operationId: null, controllerSecretHash: null }; } });
  await expectCode(runRecoveryPreflight(input(), maintenanceDeps), "recovery_maintenance_required");
  assert.equal(maintenanceDeps.calls.includes("backup"), false);
});

test("rejects controller, administrator and encryption failures before disk checks", async () => {
  const controllerDeps = dependencies({ async verifyControllerSecret() { controllerDeps.calls.push("controller"); return false; } });
  await expectCode(runRecoveryPreflight(input(), controllerDeps), "recovery_controller_invalid");
  assert.equal(controllerDeps.calls.includes("backup"), false);

  const adminDeps = dependencies({ async verifyAdministrator() { adminDeps.calls.push("administrator"); throw Object.assign(new Error("raw password mismatch"), { code: "recovery_administrator_invalid" }); } });
  await expectCode(runRecoveryPreflight(input(), adminDeps), "recovery_administrator_invalid");
  assert.equal(adminDeps.calls.some((value) => value.startsWith("space:")), false);

  const encryptionDeps = dependencies({ async verifyEncryptedMaterial() { encryptionDeps.calls.push("encryption"); throw new Error("raw encrypted payload detail"); } });
  await expectCode(runRecoveryPreflight(input(), encryptionDeps), "recovery_encryption_material_invalid");
  assert.equal(encryptionDeps.calls.some((value) => value.startsWith("space:")), false);
});

test("rejects insufficient data or artifact space with safe errors", async () => {
  const dataDeps = dependencies({ async statDiskSpace(root) { dataDeps.calls.push(`space:${root}`); return { availableBytes: root === "/data" ? 2_047 : 20_000 }; } });
  await expectCode(runRecoveryPreflight(input(), dataDeps), "recovery_disk_space_insufficient");

  const artifactDeps = dependencies({ async statDiskSpace(root) { artifactDeps.calls.push(`space:${root}`); return { availableBytes: root === "/data" ? 10_000 : 4_095 }; } });
  await expectCode(runRecoveryPreflight(input(), artifactDeps), "recovery_disk_space_insufficient");
});

test("normalizes unexpected dependency failures without exposing raw details", async () => {
  const deps = dependencies({ async discoverDatabase() { throw new Error("/data/private/opaque-db raw sqlite error"); } });
  await expectCode(runRecoveryPreflight(input(), deps), "recovery_preflight_failed");
});
