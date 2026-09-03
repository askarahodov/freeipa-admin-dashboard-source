import assert from "node:assert/strict";
import test from "node:test";

import {
  createRestoreStageBinding,
  createRestoreStageSecret,
  hashRestoreStageSecret,
  verifyRestoreStageSecret,
} from "../src/backup/restore/backup-restore-stage.ts";

const input = {
  operation: "restore",
  actorIdentity: "admin",
  selectedDomains: ["settings", "policies"],
  sourceApprovalToken: "1".repeat(64),
  recoveryManifestChecksum: "2".repeat(64),
  sourceSchemaVersion: 1,
  currentSchemaVersion: 1,
  expiresAt: 123456789,
};

test("creates a canonical 32-byte base64url stage secret", () => {
  const secret = createRestoreStageSecret((target) => {
    for (let index = 0; index < target.length; index += 1) target[index] = index;
    return target;
  });
  assert.equal(secret, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
});

test("hashes and verifies only strict stage secrets", async () => {
  const secret = createRestoreStageSecret((target) => target.fill(7));
  const hash = await hashRestoreStageSecret(secret);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await verifyRestoreStageSecret(hash, secret), true);
  assert.equal(await verifyRestoreStageSecret(hash, `${secret}=`), false);
  assert.equal(await verifyRestoreStageSecret(hash, "x"), false);
  assert.equal(await verifyRestoreStageSecret("x", secret), false);
});

test("creates a deterministic opaque binding for the complete stage context", async () => {
  const first = await createRestoreStageBinding(input);
  const second = await createRestoreStageBinding({ ...input });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);

  for (const changed of [
    { ...input, operation: "rollback" },
    { ...input, actorIdentity: "other-admin" },
    { ...input, selectedDomains: ["settings"] },
    { ...input, sourceApprovalToken: "3".repeat(64) },
    { ...input, recoveryManifestChecksum: "4".repeat(64) },
    { ...input, sourceSchemaVersion: 2 },
    { ...input, currentSchemaVersion: 2 },
    { ...input, expiresAt: input.expiresAt + 1 },
  ]) {
    assert.notEqual(await createRestoreStageBinding(changed), first);
  }
});

test("rejects malformed binding context without returning input material", async () => {
  for (const value of [
    { ...input, operation: "delete" },
    { ...input, actorIdentity: "" },
    { ...input, selectedDomains: [] },
    { ...input, sourceApprovalToken: "x" },
    { ...input, recoveryManifestChecksum: "x" },
    { ...input, sourceSchemaVersion: 0 },
    { ...input, expiresAt: 0 },
  ]) {
    await assert.rejects(
      () => createRestoreStageBinding(value),
      (error) => error?.code === "backup_restore_stage_invalid"
        && !String(error?.message ?? "").includes("1".repeat(16))
        && !String(error?.message ?? "").includes("2".repeat(16)),
    );
  }
});
