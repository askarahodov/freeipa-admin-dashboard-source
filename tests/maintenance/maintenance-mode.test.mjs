import assert from "node:assert/strict";
import test from "node:test";

import {
  MaintenanceModeError,
  adminMaintenanceStatus,
  createMaintenanceControllerSecret,
  createMaintenanceOperationId,
  hashMaintenanceControllerSecret,
  maintenanceConfirmation,
  publicMaintenanceStatus,
  validateMaintenanceVerification,
  verifyMaintenanceControllerSecret,
} from "../src/recovery/maintenance/maintenance-mode.ts";

const activeRow = {
  id: "main",
  state: "active",
  operationId: "maintenance_11111111-1111-4111-8111-111111111111",
  actorIdentity: "admin@example.test",
  actorGroups: ["portal-admins"],
  controllerSecretHash: "a".repeat(64),
  createdAt: 1_000,
  updatedAt: 2_000,
  expiresAt: null,
  completedAt: null,
  failureCode: null,
  verification: {},
};

test("creates canonical operation ids and 32-byte base64url controller secrets", () => {
  assert.match(createMaintenanceOperationId(), /^maintenance_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const first = createMaintenanceControllerSecret();
  const second = createMaintenanceControllerSecret();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("hashes and verifies strict controller secrets without accepting malformed input", async () => {
  const secret = createMaintenanceControllerSecret();
  const changed = `${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;
  const hash = await hashMaintenanceControllerSecret(secret);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await verifyMaintenanceControllerSecret(hash, secret), true);
  assert.equal(await verifyMaintenanceControllerSecret(hash, changed), false);
  assert.equal(await verifyMaintenanceControllerSecret(hash.toUpperCase(), secret), false);
  assert.equal(await verifyMaintenanceControllerSecret(hash, "short"), false);
});

test("derives exact confirmation challenges for every state transition", () => {
  const id = activeRow.operationId;
  assert.equal(maintenanceConfirmation("enter", id), `ENTER:${id}`);
  assert.equal(maintenanceConfirmation("verify", id), `VERIFY:${id}`);
  assert.equal(maintenanceConfirmation("exit", id), `EXIT:${id}`);
  assert.equal(maintenanceConfirmation("complete", id), `RESUME:${id}`);
  assert.equal(maintenanceConfirmation("cancel", id), `CANCEL:${id}`);
  assert.throws(() => maintenanceConfirmation("delete", id), MaintenanceModeError);
});

test("accepts only the exact aggregate verification object", () => {
  const verification = {
    integrity: "ok",
    schema: "ok",
    administratorAccess: "ok",
    settingsDecryption: "ok",
    auditWrite: "ok",
  };
  assert.deepEqual(validateMaintenanceVerification(verification), verification);
  for (const value of [
    { ...verification, integrity: "failed" },
    { ...verification, extra: "ok" },
    { ...verification, auditWrite: true },
    null,
    [],
  ]) {
    assert.throws(
      () => validateMaintenanceVerification(value),
      (error) => error instanceof MaintenanceModeError
        && error.code === "maintenance_verification_invalid"
        && error.status === 422,
    );
  }
});

test("returns bounded public and administrator-safe projections", () => {
  assert.deepEqual(publicMaintenanceStatus(activeRow), {
    maintenance: true,
    state: "active",
    updatedAt: 2_000,
    recoveryRequired: true,
  });
  const admin = adminMaintenanceStatus(activeRow);
  assert.deepEqual(admin, {
    maintenance: true,
    state: "active",
    operationId: activeRow.operationId,
    createdAt: 1_000,
    updatedAt: 2_000,
    expiresAt: null,
    completedAt: null,
    recoveryRequired: true,
    failureCode: null,
    verification: {},
  });
  const serialized = JSON.stringify({ public: publicMaintenanceStatus(activeRow), admin });
  for (const forbidden of [activeRow.actorIdentity, "portal-admins", activeRow.controllerSecretHash]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("absence is inactive and malformed persisted state fails closed", () => {
  assert.deepEqual(publicMaintenanceStatus(null), {
    maintenance: false,
    state: "inactive",
    updatedAt: null,
    recoveryRequired: false,
  });
  const malformed = publicMaintenanceStatus({ ...activeRow, state: "unknown" });
  assert.deepEqual(malformed, {
    maintenance: true,
    state: "failed",
    updatedAt: 2_000,
    recoveryRequired: true,
  });
});
