import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecoveryReceipt,
  transitionRecoveryReceipt,
} from "../recovery-receipt.ts";
import {
  rollbackRecoverySwap,
  swapRecoveryCandidate,
} from "../recovery-swap.ts";

const originalHash = "a".repeat(64);
const candidateHash = "b".repeat(64);
const recoveryPointHash = "c".repeat(64);

function candidateReadyReceipt() {
  const base = createRecoveryReceipt({
    operationId: "recovery_11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-04T08:00:00.000Z",
    liveDatabaseRelativePath: "state/v3/d1/live.sqlite",
    liveDatabaseSha256: originalHash,
    liveDatabaseBytes: 100,
    schemaVersion: 3,
    maintenanceOperationId: "maintenance_22222222-2222-4222-8222-222222222222",
    backupManifestSha256: "d".repeat(64),
    recoveryPointRelativePath: "points/original.sqlite.enc",
    recoveryPointSha256: recoveryPointHash,
    recoveryPointBytes: 200,
    confirmation: "RESTORE PORTAL DATABASE recovery_11111111-1111-4111-8111-111111111111",
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
    },
  });
  return transitionRecoveryReceipt(base, "candidate_ready", "2026-08-04T08:01:00.000Z");
}

function fixture() {
  let receipt = candidateReadyReceipt();
  const files = new Map([
    ["/data/live.sqlite", { sha256: originalHash, bytes: 100, dev: 7, regular: true }],
    ["/data/candidate.sqlite", { sha256: candidateHash, bytes: 120, dev: 7, regular: true }],
    ["/data/.portal-exclusive.lock", { sha256: null, bytes: 0, dev: 7, regular: true }],
  ]);
  const operations = [];
  const dependencies = {
    async loadReceipt() { operations.push("load-receipt"); return receipt; },
    async writeReceipt(_path, value) { operations.push(`write:${value.phase}`); receipt = value; return value; },
    async inspectFile(path) {
      const value = files.get(path);
      return value ? { exists: true, ...value } : { exists: false };
    },
    async fingerprintFile(path) {
      const value = files.get(path);
      if (!value?.regular || !value.sha256) throw new Error("missing file");
      return { sha256: value.sha256, bytes: value.bytes };
    },
    async assertLockHeld(path) {
      operations.push(`lock:${path}`);
      if (!files.has(path)) throw new Error("lock missing");
    },
    async fsyncFile(path) { operations.push(`fsync-file:${path}`); },
    async fsyncDirectory(path) { operations.push(`fsync-dir:${path}`); },
    async rename(source, destination) {
      operations.push(`rename:${source}->${destination}`);
      if (files.has(destination)) throw new Error("destination exists");
      const value = files.get(source);
      if (!value) throw new Error("source missing");
      files.delete(source);
      files.set(destination, value);
    },
    async remove(path) { operations.push(`remove:${path}`); files.delete(path); },
    async materializeRecoveryPoint({ destinationPath }) {
      operations.push(`materialize:${destinationPath}`);
      files.set(destinationPath, { sha256: originalHash, bytes: 100, dev: 7, regular: true });
      return { sha256: originalHash, bytes: 100 };
    },
    async checkpoint(name) { operations.push(`checkpoint:${name}`); },
    now() {
      const offset = operations.filter((item) => item.startsWith("write:")).length + 2;
      return `2026-08-04T08:0${offset}:00.000Z`;
    },
  };
  return { files, operations, dependencies, getReceipt: () => receipt };
}

const swapInput = {
  receiptPath: "/artifacts/receipt.json",
  livePath: "/data/live.sqlite",
  candidatePath: "/data/candidate.sqlite",
  rollbackPath: "/data/rollback.sqlite",
  expectedLiveSha256: originalHash,
  expectedCandidateSha256: candidateHash,
  lockPath: "/data/.portal-exclusive.lock",
};

test("atomically swaps a verified candidate and records phases", async () => {
  const value = fixture();
  const receipt = await swapRecoveryCandidate(swapInput, value.dependencies);

  assert.equal(receipt.phase, "swapped");
  assert.equal(receipt.checks.swap, "ok");
  assert.equal(value.files.get("/data/live.sqlite").sha256, candidateHash);
  assert.equal(value.files.get("/data/rollback.sqlite").sha256, originalHash);
  assert.equal(value.files.has("/data/candidate.sqlite"), false);
  assert.deepEqual(value.operations, [
    "load-receipt",
    "lock:/data/.portal-exclusive.lock",
    "fsync-file:/data/candidate.sqlite",
    "write:swap_started",
    "checkpoint:before_live_rename",
    "rename:/data/live.sqlite->/data/rollback.sqlite",
    "checkpoint:after_live_rename",
    "rename:/data/candidate.sqlite->/data/live.sqlite",
    "checkpoint:after_candidate_rename",
    "fsync-dir:/data",
    "checkpoint:after_directory_fsync",
    "write:swapped",
  ]);
});

test("never overwrites an existing rollback path", async () => {
  const value = fixture();
  value.files.set("/data/rollback.sqlite", { sha256: "e".repeat(64), bytes: 80, dev: 7, regular: true });
  await assert.rejects(
    swapRecoveryCandidate(swapInput, value.dependencies),
    (error) => error.code === "recovery_rollback_exists",
  );
  assert.equal(value.getReceipt().phase, "candidate_ready");
  assert.equal(value.files.get("/data/live.sqlite").sha256, originalHash);
});

test("a crash after the first rename leaves a classifiable swap_started state", async () => {
  const value = fixture();
  value.dependencies.checkpoint = async (name) => {
    value.operations.push(`checkpoint:${name}`);
    if (name === "after_live_rename") throw new Error("injected crash");
  };
  await assert.rejects(
    swapRecoveryCandidate(swapInput, value.dependencies),
    (error) => error.code === "recovery_swap_incomplete",
  );
  assert.equal(value.getReceipt().phase, "swap_started");
  assert.equal(value.files.has("/data/live.sqlite"), false);
  assert.equal(value.files.get("/data/rollback.sqlite").sha256, originalHash);
  assert.equal(value.files.get("/data/candidate.sqlite").sha256, candidateHash);
});

test("rolls back using the retained original database", async () => {
  const value = fixture();
  value.files.delete("/data/candidate.sqlite");
  value.files.set("/data/live.sqlite", { sha256: candidateHash, bytes: 120, dev: 7, regular: true });
  value.files.set("/data/rollback.sqlite", { sha256: originalHash, bytes: 100, dev: 7, regular: true });
  let receipt = transitionRecoveryReceipt(value.getReceipt(), "swap_started", "2026-08-04T08:02:00.000Z");
  receipt = transitionRecoveryReceipt({ ...receipt, checks: { ...receipt.checks, swap: "ok" } }, "swapped", "2026-08-04T08:03:00.000Z");
  value.dependencies.loadReceipt = async () => receipt;
  value.dependencies.writeReceipt = async (_path, next) => { receipt = next; return next; };

  const result = await rollbackRecoverySwap({
    receiptPath: "/artifacts/receipt.json",
    livePath: "/data/live.sqlite",
    rollbackPath: "/data/rollback.sqlite",
    failedPath: "/data/failed.sqlite",
    recoveryPointPath: "/artifacts/points/original.sqlite.enc",
    recoveryPassword: "secret",
    recoveryTempPath: "/data/recovered.sqlite",
    expectedCurrentSha256: candidateHash,
    expectedOriginalSha256: originalHash,
    lockPath: "/data/.portal-exclusive.lock",
  }, value.dependencies);

  assert.equal(result.phase, "rolled_back");
  assert.equal(result.checks.rollback, "ok");
  assert.equal(value.files.get("/data/live.sqlite").sha256, originalHash);
  assert.equal(value.files.get("/data/failed.sqlite").sha256, candidateHash);
  assert.equal(value.files.has("/data/rollback.sqlite"), false);
  assert.equal(value.operations.some((item) => item.startsWith("materialize:")), false);
});

test("falls back to the encrypted recovery point when rollback is missing", async () => {
  const value = fixture();
  value.files.delete("/data/candidate.sqlite");
  value.files.set("/data/live.sqlite", { sha256: candidateHash, bytes: 120, dev: 7, regular: true });
  let receipt = transitionRecoveryReceipt(value.getReceipt(), "swap_started", "2026-08-04T08:02:00.000Z");
  receipt = transitionRecoveryReceipt({ ...receipt, checks: { ...receipt.checks, swap: "ok" } }, "swapped", "2026-08-04T08:03:00.000Z");
  value.dependencies.loadReceipt = async () => receipt;
  value.dependencies.writeReceipt = async (_path, next) => { receipt = next; return next; };

  const result = await rollbackRecoverySwap({
    receiptPath: "/artifacts/receipt.json",
    livePath: "/data/live.sqlite",
    rollbackPath: "/data/rollback.sqlite",
    failedPath: "/data/failed.sqlite",
    recoveryPointPath: "/artifacts/points/original.sqlite.enc",
    recoveryPassword: "secret",
    recoveryTempPath: "/data/recovered.sqlite",
    expectedCurrentSha256: candidateHash,
    expectedOriginalSha256: originalHash,
    lockPath: "/data/.portal-exclusive.lock",
  }, value.dependencies);

  assert.equal(result.phase, "rolled_back");
  assert.equal(value.files.get("/data/live.sqlite").sha256, originalHash);
  assert.equal(value.operations.includes("materialize:/data/recovered.sqlite"), true);
});
