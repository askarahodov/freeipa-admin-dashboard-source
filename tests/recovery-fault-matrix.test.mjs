import assert from "node:assert/strict";
import test from "node:test";

import {
  bindRecoveryCandidateReceipt,
  createRecoveryReceipt,
} from "../src/recovery/foundation/recovery-receipt.ts";
import { swapRecoveryCandidate } from "../recovery-swap.ts";
import { classifyRecoveryFilesystem } from "../recovery-reconcile.ts";

const originalHash = "a".repeat(64);
const candidateHash = "b".repeat(64);
const operationId = "recovery_11111111-1111-4111-8111-111111111111";

function receipt() {
  return bindRecoveryCandidateReceipt(createRecoveryReceipt({
    operationId,
    createdAt: "2026-08-04T08:00:00.000Z",
    liveDatabaseRelativePath: "state/v3/d1/live.sqlite",
    liveDatabaseSha256: originalHash,
    liveDatabaseBytes: 100,
    schemaVersion: 3,
    maintenanceOperationId: "maintenance_22222222-2222-4222-8222-222222222222",
    backupManifestSha256: "c".repeat(64),
    recoveryPointRelativePath: "points/original.sqlite.enc",
    recoveryPointSha256: "d".repeat(64),
    recoveryPointBytes: 200,
    confirmation: `RESTORE PORTAL DATABASE ${operationId}`,
    checks: {
      checkpoint: "ok",
      sourceIntegrity: "ok",
      encryptedRoundTrip: "ok",
      recoveryPointIntegrity: "ok",
    },
  }), {
    candidateRelativePath: "state/v3/d1/candidate.sqlite",
    candidateSha256: candidateHash,
    candidateBytes: 120,
    rollbackRelativePath: "state/v3/d1/rollback.sqlite",
    checks: {
      candidateIntegrity: "ok",
      candidateSchema: "ok",
      candidateAdministrator: "ok",
      candidateEncryption: "ok",
      candidateAudit: "ok",
    },
  }, "2026-08-04T08:01:00.000Z");
}

function harness(failurePoint) {
  let currentReceipt = receipt();
  const files = new Map([
    ["/data/live.sqlite", { sha256: originalHash, bytes: 100, dev: 7, regular: true }],
    ["/data/candidate.sqlite", { sha256: candidateHash, bytes: 120, dev: 7, regular: true }],
    ["/data/.portal-exclusive.lock", { sha256: null, bytes: 0, dev: 7, regular: true }],
  ]);
  const fail = (point) => {
    if (failurePoint === point) throw new Error(`injected:${point}`);
  };
  const dependencies = {
    async loadReceipt() { return currentReceipt; },
    async writeReceipt(_path, next) { fail(`write:${next.phase}`); currentReceipt = next; return next; },
    async inspectFile(path) {
      const value = files.get(path);
      return value ? { exists: true, ...value } : { exists: false };
    },
    async fingerprintFile(path) {
      const value = files.get(path);
      if (!value?.sha256) throw new Error("missing");
      return { sha256: value.sha256, bytes: value.bytes };
    },
    async assertLockHeld() { fail("lock"); },
    async fsyncFile() { fail("fsync:candidate"); },
    async fsyncDirectory() { fail("fsync:directory"); },
    async rename(source, destination) {
      const label = source.includes("candidate") ? "rename:candidate" : "rename:live";
      fail(label);
      const value = files.get(source);
      if (!value || files.has(destination)) throw new Error("invalid rename");
      files.delete(source);
      files.set(destination, value);
    },
    async remove(path) { files.delete(path); },
    async materializeRecoveryPoint() { throw new Error("not used"); },
    async checkpoint(point) { fail(`checkpoint:${point}`); },
    now() { return currentReceipt.phase === "candidate_ready" ? "2026-08-04T08:02:00.000Z" : "2026-08-04T08:03:00.000Z"; },
  };
  return { files, dependencies, getReceipt: () => currentReceipt };
}

function fileState(files, path) {
  const value = files.get(path);
  return value ? { exists: true, regular: true, ...value } : { exists: false };
}

const boundaries = [
  "lock",
  "fsync:candidate",
  "write:swap_started",
  "checkpoint:before_live_rename",
  "rename:live",
  "checkpoint:after_live_rename",
  "rename:candidate",
  "checkpoint:after_candidate_rename",
  "fsync:directory",
  "checkpoint:after_directory_fsync",
  "write:swapped",
];

for (const boundary of boundaries) {
  test(`swap fault boundary ${boundary} is fail-closed or classifiable`, async () => {
    const value = harness(boundary);
    await assert.rejects(
      swapRecoveryCandidate({
        receiptPath: "/artifacts/receipt.json",
        livePath: "/data/live.sqlite",
        candidatePath: "/data/candidate.sqlite",
        rollbackPath: "/data/rollback.sqlite",
        expectedLiveSha256: originalHash,
        expectedCandidateSha256: candidateHash,
        lockPath: "/data/.portal-exclusive.lock",
      }, value.dependencies),
    );
    const live = fileState(value.files, "/data/live.sqlite");
    const candidate = fileState(value.files, "/data/candidate.sqlite");
    const rollback = fileState(value.files, "/data/rollback.sqlite");
    const phase = value.getReceipt().phase;

    if (phase === "candidate_ready") {
      assert.equal(live.exists && live.sha256, originalHash);
      assert.equal(candidate.exists && candidate.sha256, candidateHash);
      assert.equal(rollback.exists, false);
      return;
    }

    assert.equal(phase, "swap_started");
    const classification = classifyRecoveryFilesystem({
      phase,
      live,
      candidate,
      rollback,
      originalSha256: originalHash,
      candidateSha256: candidateHash,
    });
    assert.ok(["ready_to_swap", "finish_swap", "continue_verification"].includes(classification.action));
  });
}

test("fault injection is dependency-only and absent from production environment parsing", async () => {
  const sources = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../recovery-swap.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../recovery-reconcile.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../scripts/portal-recovery.ts", import.meta.url), "utf8")),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /FAULT|INJECT|FAIL_AFTER|PORTAL_RECOVERY_TEST_MODE/u);
  }
});
