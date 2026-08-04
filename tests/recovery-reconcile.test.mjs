import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecoveryReceipt,
  transitionRecoveryReceipt,
} from "../recovery-receipt.ts";
import {
  classifyRecoveryFilesystem,
  reconcileRecoveryReceipt,
} from "../recovery-reconcile.ts";

const originalHash = "a".repeat(64);
const candidateHash = "b".repeat(64);

function file(sha256) {
  return { exists: true, regular: true, sha256, bytes: 100, dev: 7 };
}
const missing = { exists: false };

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
    recoveryPointSha256: "c".repeat(64),
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

function swapStartedReceipt() {
  return transitionRecoveryReceipt(candidateReadyReceipt(), "swap_started", "2026-08-04T08:02:00.000Z");
}

test("classifies every supported swap filesystem state without timestamps", () => {
  assert.equal(classifyRecoveryFilesystem({
    phase: "candidate_ready",
    live: file(originalHash),
    candidate: file(candidateHash),
    rollback: missing,
    originalSha256: originalHash,
    candidateSha256: candidateHash,
  }).action, "ready_to_swap");

  assert.equal(classifyRecoveryFilesystem({
    phase: "swap_started",
    live: missing,
    candidate: file(candidateHash),
    rollback: file(originalHash),
    originalSha256: originalHash,
    candidateSha256: candidateHash,
  }).action, "finish_swap");

  assert.equal(classifyRecoveryFilesystem({
    phase: "swap_started",
    live: missing,
    candidate: missing,
    rollback: file(originalHash),
    originalSha256: originalHash,
    candidateSha256: candidateHash,
  }).action, "restore_original");

  assert.equal(classifyRecoveryFilesystem({
    phase: "swap_started",
    live: file(candidateHash),
    candidate: missing,
    rollback: file(originalHash),
    originalSha256: originalHash,
    candidateSha256: candidateHash,
  }).action, "continue_verification");
});

test("rejects hash mismatch and multiple plausible live databases", () => {
  const cases = [
    {
      phase: "swap_started",
      live: file("c".repeat(64)), candidate: missing, rollback: file(originalHash),
    },
    {
      phase: "swap_started",
      live: file(originalHash), candidate: file(candidateHash), rollback: file(originalHash),
    },
    {
      phase: "swapped",
      live: file(candidateHash), candidate: file(candidateHash), rollback: file(originalHash),
    },
  ];
  for (const value of cases) {
    assert.throws(
      () => classifyRecoveryFilesystem({ ...value, originalSha256: originalHash, candidateSha256: candidateHash }),
      (error) => error.code === "recovery_filesystem_ambiguous",
    );
  }
});

test("finishes an interrupted second rename and fsyncs the directory", async () => {
  const operations = [];
  const state = {
    live: missing,
    candidate: file(candidateHash),
    rollback: file(originalHash),
  };
  let receipt = swapStartedReceipt();
  const result = await reconcileRecoveryReceipt({
    receiptPath: "/artifacts/receipt.json",
    livePath: "/data/live.sqlite",
    candidatePath: "/data/candidate.sqlite",
    rollbackPath: "/data/rollback.sqlite",
    expectedOriginalSha256: originalHash,
    expectedCandidateSha256: candidateHash,
    lockPath: "/data/.portal-exclusive.lock",
  }, {
    async loadReceipt() { return receipt; },
    async writeReceipt(_path, next) { receipt = next; operations.push(`write:${next.phase}`); return next; },
    async inspectFile(path) {
      if (path.endsWith("live.sqlite")) return state.live;
      if (path.endsWith("candidate.sqlite")) return state.candidate;
      if (path.endsWith("rollback.sqlite")) return state.rollback;
      return file(null);
    },
    async assertLockHeld() { operations.push("lock"); },
    async rename(source, destination) {
      operations.push(`rename:${source}->${destination}`);
      state.live = state.candidate;
      state.candidate = missing;
    },
    async fsyncDirectory(path) { operations.push(`fsync:${path}`); },
    async fingerprintFile(path) {
      return path.endsWith("live.sqlite")
        ? { sha256: state.live.sha256, bytes: state.live.bytes }
        : { sha256: state.rollback.sha256, bytes: state.rollback.bytes };
    },
    now() { return "2026-08-04T08:03:00.000Z"; },
  });

  assert.equal(result.action, "continue_verification");
  assert.equal(result.receipt.phase, "swapped");
  assert.deepEqual(operations, [
    "lock",
    "rename:/data/candidate.sqlite->/data/live.sqlite",
    "fsync:/data",
    "write:swapped",
  ]);
});

test("reverses the first rename when the candidate disappeared", async () => {
  const operations = [];
  const state = { live: missing, candidate: missing, rollback: file(originalHash) };
  let receipt = swapStartedReceipt();
  const result = await reconcileRecoveryReceipt({
    receiptPath: "/artifacts/receipt.json",
    livePath: "/data/live.sqlite",
    candidatePath: "/data/candidate.sqlite",
    rollbackPath: "/data/rollback.sqlite",
    expectedOriginalSha256: originalHash,
    expectedCandidateSha256: candidateHash,
    lockPath: "/data/.portal-exclusive.lock",
  }, {
    async loadReceipt() { return receipt; },
    async writeReceipt(_path, next) { receipt = next; operations.push(`write:${next.phase}`); return next; },
    async inspectFile(path) {
      if (path.endsWith("live.sqlite")) return state.live;
      if (path.endsWith("candidate.sqlite")) return state.candidate;
      if (path.endsWith("rollback.sqlite")) return state.rollback;
      return file(null);
    },
    async assertLockHeld() { operations.push("lock"); },
    async rename(source, destination) {
      operations.push(`rename:${source}->${destination}`);
      state.live = state.rollback;
      state.rollback = missing;
    },
    async fsyncDirectory(path) { operations.push(`fsync:${path}`); },
    async fingerprintFile() { return { sha256: originalHash, bytes: 100 }; },
    now() { return "2026-08-04T08:03:00.000Z"; },
  });

  assert.equal(result.action, "restored_original");
  assert.equal(result.receipt.phase, "failed");
  assert.deepEqual(operations, [
    "lock",
    "rename:/data/rollback.sqlite->/data/live.sqlite",
    "fsync:/data",
    "write:failed",
  ]);
});
