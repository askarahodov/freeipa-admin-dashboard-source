import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createRecoveryReceipt,
  loadRecoveryReceipt,
  transitionRecoveryReceipt,
  validateRecoveryReceipt,
  writeRecoveryReceiptAtomic,
} from "../recovery-receipt.ts";

const createdAt = "2026-08-04T08:00:00.000Z";
const laterAt = "2026-08-04T08:01:00.000Z";
const now = Date.parse("2026-08-04T09:00:00.000Z");

function input(overrides = {}) {
  return {
    operationId: "recovery_11111111-1111-4111-8111-111111111111",
    createdAt,
    liveDatabaseRelativePath: "state/v3/d1/opaque.sqlite",
    liveDatabaseSha256: "a".repeat(64),
    liveDatabaseBytes: 1024,
    schemaVersion: 3,
    maintenanceOperationId: "maintenance_22222222-2222-4222-8222-222222222222",
    backupManifestSha256: "b".repeat(64),
    recoveryPointRelativePath: "points/recovery-11111111.sqlite.enc",
    recoveryPointSha256: "c".repeat(64),
    recoveryPointBytes: 2048,
    confirmation: "RESTORE PORTAL DATABASE recovery_11111111-1111-4111-8111-111111111111",
    checks: {
      checkpoint: "ok",
      sourceIntegrity: "ok",
      encryptedRoundTrip: "ok",
      recoveryPointIntegrity: "ok",
    },
    ...overrides,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-receipt-"));
  await mkdir(join(root, "receipts"), { mode: 0o700 });
  return { root, path: join(root, "receipts", "operation.json") };
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error && error.code === code && !String(error.message).includes("opaque.sqlite"),
  );
}

test("creates a frozen canonical recovery-point receipt", () => {
  const receipt = createRecoveryReceipt(input());
  assert.deepEqual(receipt, {
    format: "portal-offline-recovery-receipt",
    version: 1,
    operationId: input().operationId,
    createdAt,
    updatedAt: createdAt,
    phase: "recovery_point_ready",
    liveDatabaseRelativePath: input().liveDatabaseRelativePath,
    liveDatabaseSha256: input().liveDatabaseSha256,
    liveDatabaseBytes: 1024,
    schemaVersion: 3,
    maintenanceOperationId: input().maintenanceOperationId,
    backupManifestSha256: input().backupManifestSha256,
    recoveryPointRelativePath: input().recoveryPointRelativePath,
    recoveryPointSha256: input().recoveryPointSha256,
    recoveryPointBytes: 2048,
    confirmation: input().confirmation,
    checks: input().checks,
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.checks), true);
});

test("writes canonical JSON atomically with mode 0600 and loads it", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const receipt = createRecoveryReceipt(input());

  await writeRecoveryReceiptAtomic(value.path, receipt);
  const metadata = await stat(value.path);
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(await readFile(value.path, "utf8"), `${canonical(receipt)}\n`);
  assert.deepEqual(await loadRecoveryReceipt(value.path, { now }), receipt);
  assert.deepEqual(await readdir(join(value.root, "receipts")), ["operation.json"]);
});

test("rejects unknown fields malformed hashes unsafe paths and future timestamps", async () => {
  const receipt = createRecoveryReceipt(input());
  const cases = [
    { ...receipt, unexpected: true },
    { ...receipt, liveDatabaseSha256: "not-a-hash" },
    { ...receipt, liveDatabaseRelativePath: "/absolute/database.sqlite" },
    { ...receipt, recoveryPointRelativePath: "../outside.enc" },
    { ...receipt, updatedAt: "2026-08-04T10:00:00.000Z" },
    { ...receipt, checks: { checkpoint: "ok", secret: "controller-value" } },
  ];
  for (const candidate of cases) {
    assert.throws(
      () => validateRecoveryReceipt(candidate, { now }),
      (error) => error.code === "recovery_receipt_invalid",
    );
  }
});

test("permits only explicit receipt phase transitions", () => {
  const ready = createRecoveryReceipt(input());
  const candidate = transitionRecoveryReceipt(ready, "candidate_ready", laterAt);
  assert.equal(candidate.phase, "candidate_ready");
  assert.equal(candidate.updatedAt, laterAt);
  assert.equal(Object.isFrozen(candidate), true);

  assert.throws(
    () => transitionRecoveryReceipt(candidate, "recovery_point_ready", "2026-08-04T08:02:00.000Z"),
    (error) => error.code === "recovery_receipt_phase_invalid",
  );
  assert.throws(
    () => transitionRecoveryReceipt(candidate, "verified", "2026-08-04T08:02:00.000Z"),
    (error) => error.code === "recovery_receipt_phase_invalid",
  );

  const failed = transitionRecoveryReceipt(candidate, "failed", "2026-08-04T08:02:00.000Z");
  assert.equal(failed.phase, "failed");
  assert.equal(transitionRecoveryReceipt(failed, "rollback_started", "2026-08-04T08:03:00.000Z").phase, "rollback_started");
});

test("rejects symlink receipt targets and insecure existing files", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const receipt = createRecoveryReceipt(input());
  const target = join(value.root, "receipts", "target.json");
  await writeFile(target, `${canonical(receipt)}\n`, { mode: 0o600 });
  await symlink(target, value.path);

  await expectCode(loadRecoveryReceipt(value.path, { now }), "recovery_receipt_invalid");
  await expectCode(writeRecoveryReceiptAtomic(value.path, receipt), "recovery_receipt_invalid");

  await rm(value.path);
  await chmod(target, 0o640);
  await expectCode(loadRecoveryReceipt(target, { now }), "recovery_receipt_permissions_invalid");
});

test("removes the temporary file when atomic rename fails", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const receipt = createRecoveryReceipt(input());
  let attemptedTemp = null;

  await expectCode(writeRecoveryReceiptAtomic(value.path, receipt, {
    async rename(source) {
      attemptedTemp = source;
      throw new Error("raw rename failure");
    },
  }), "recovery_receipt_write_failed");

  assert.equal(await lstat(value.path).then(() => true, () => false), false);
  assert.ok(attemptedTemp);
  assert.equal(await lstat(attemptedTemp).then(() => true, () => false), false);
  assert.deepEqual(await readdir(join(value.root, "receipts")), []);
});
