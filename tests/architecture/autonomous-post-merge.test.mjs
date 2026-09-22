import assert from "node:assert/strict";
import test from "node:test";

import { formatAutonomousTaskMarker } from "../../scripts/autonomous-task-state.mjs";
import {
  evaluateAutonomousPostMergeCheckpoint,
  planAutonomousPostMergeContinuation,
} from "../../scripts/autonomous-post-merge.mjs";

const MAIN = "aaaaaaaaaaaaaaaa";

const managed = (number, {
  state = "open",
  stateReason,
  label = "ai:review",
  priority = "P1",
  dependsOn = [],
  humanApprovalRequired = false,
} = {}) => ({
  number,
  state,
  state_reason: stateReason,
  labels: [label],
  body: formatAutonomousTaskMarker({
    priority,
    dependsOn,
    humanApprovalRequired,
  }),
});

const greenCheck = () => ({
  headSha: MAIN,
  status: "completed",
  conclusion: "success",
});

const validCheckpointSnapshot = (overrides = {}) => ({
  currentMainSha: MAIN,
  issue: managed(10),
  mergeEvidence: {
    merged: true,
    issue: 10,
    pullRequest: 100,
    mergeCommitSha: "cccccccccccccccc",
    mergeCommitReachableFromMain: true,
    changePresent: true,
    changeVerifiedOnMainSha: MAIN,
  },
  checks: {
    requiredCi: greenCheck(),
    scopedE2E: greenCheck(),
  },
  acceptance: {
    completed: true,
    satisfied: true,
    mainSha: MAIN,
  },
  ...overrides,
});

test("merge alone is not DONE while post-merge checks are pending", () => {
  const snapshot = validCheckpointSnapshot();
  snapshot.checks.requiredCi = {
    headSha: MAIN,
    status: "in_progress",
    conclusion: null,
  };

  const result = evaluateAutonomousPostMergeCheckpoint(snapshot);
  assert.equal(result.decision, "WAIT");
  assert.equal(result.transition, null);
  assert.ok(result.pending.includes("post_merge_check_pending:Required CI"));
});

test("red resulting main blocks DONE and ordinary next-task progression", () => {
  const snapshot = validCheckpointSnapshot();
  snapshot.checks.scopedE2E = {
    headSha: MAIN,
    status: "completed",
    conclusion: "failure",
  };

  const result = evaluateAutonomousPostMergeCheckpoint(snapshot);
  assert.equal(result.decision, "REGRESSION_BLOCKED");
  assert.equal(result.transition, null);
  assert.equal(result.nextAction, "BOUNDED_HOTFIX_OR_REVERT");
});

test("healthy resulting main authorizes REVIEW to DONE transition", () => {
  const result = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  assert.equal(result.decision, "VERIFIED_CHECKPOINT");
  assert.deepEqual(result.transition, {
    issue: 10,
    from: "REVIEW",
    to: "DONE",
    githubState: "closed",
    stateReason: "completed",
  });
  assert.equal(result.mainSha, MAIN);
});

test("unreachable merge commit or missing merged change fails closed", () => {
  const snapshot = validCheckpointSnapshot();
  snapshot.mergeEvidence.mergeCommitReachableFromMain = false;
  snapshot.mergeEvidence.changePresent = false;

  const result = evaluateAutonomousPostMergeCheckpoint(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("merge_commit_not_verified_reachable_from_main"));
  assert.ok(result.reasons.includes("merged_change_not_verified_present"));
});

test("a newer main is valid when the merge commit is reachable and change is reverified", () => {
  const result = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  assert.equal(result.decision, "VERIFIED_CHECKPOINT");
  assert.notEqual(result.evidence.mergeCommitSha, result.mainSha);
});

test("post-merge acceptance must be satisfied on resulting main", () => {
  const snapshot = validCheckpointSnapshot();
  snapshot.acceptance.satisfied = false;

  const result = evaluateAutonomousPostMergeCheckpoint(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("post_merge_acceptance_not_satisfied_or_stale"));
});

test("stale post-merge check evidence fails closed", () => {
  const snapshot = validCheckpointSnapshot();
  snapshot.checks.requiredCi.headSha = "bbbbbbbbbbbbbbbb";

  const result = evaluateAutonomousPostMergeCheckpoint(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("post_merge_check_stale:Required CI"));
});

function continuationSnapshot() {
  return {
    githubAvailable: true,
    refreshPhase: "after_issue_close",
    mainSha: MAIN,
    openPullRequests: [],
    issues: [
      managed(10, {
        state: "closed",
        stateReason: "completed",
        label: "ai:review",
      }),
      managed(20, {
        label: "ai:ready",
        priority: "P0",
        dependsOn: [10],
      }),
    ],
    collisionEvidence: {
      "20": "clean",
    },
    rankingEvidence: {
      "20": {
        securityCorrectness: 0,
        userOperationalImpact: 0,
        unlockValue: 0,
        implementationCost: 1,
      },
    },
  };
}

test("end-to-end DONE to next READY uses fresh post-close state", () => {
  const checkpoint = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  const result = planAutonomousPostMergeContinuation({
    checkpoint,
    freshSnapshot: continuationSnapshot(),
    currentIteration: 1,
    maxIterations: 5,
  });

  assert.equal(result.decision, "CONTINUE");
  assert.equal(result.selected.issue, 20);
  assert.equal(result.nextIteration, 2);
  assert.equal(result.selectorDecision.evidence.mainSha, MAIN);
});

test("pre-close or stale snapshot cannot select next work", () => {
  const checkpoint = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  const stale = continuationSnapshot();
  stale.refreshPhase = "before_issue_close";

  const result = planAutonomousPostMergeContinuation({
    checkpoint,
    freshSnapshot: stale,
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "fresh_post_close_github_snapshot_required");
});

test("current issue must be observed as DONE before continuation", () => {
  const checkpoint = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  const fresh = continuationSnapshot();
  fresh.issues[0] = managed(10, { label: "ai:review" });

  const result = planAutonomousPostMergeContinuation({
    checkpoint,
    freshSnapshot: fresh,
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "current_issue_not_confirmed_done_after_close");
});

test("NO_WORK stops cleanly", () => {
  const checkpoint = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  const fresh = continuationSnapshot();
  fresh.issues = [
    managed(10, {
      state: "closed",
      stateReason: "completed",
      label: "ai:review",
    }),
  ];
  fresh.collisionEvidence = {};
  fresh.rankingEvidence = {};

  const result = planAutonomousPostMergeContinuation({
    checkpoint,
    freshSnapshot: fresh,
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "no_executable_ready_work");
});

test("selector BLOCKED stops instead of guessing or bypassing human approval", () => {
  const checkpoint = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  const fresh = continuationSnapshot();
  fresh.issues[1] = managed(20, {
    label: "ai:ready",
    priority: "P0",
    dependsOn: [10],
    humanApprovalRequired: true,
  });

  const result = planAutonomousPostMergeContinuation({
    checkpoint,
    freshSnapshot: fresh,
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "selector_blocked_or_requires_human_action");
  assert.equal(result.selectorDecision.decision, "BLOCKED");
});

test("continuous loop has a hard iteration bound", () => {
  const checkpoint = evaluateAutonomousPostMergeCheckpoint(validCheckpointSnapshot());
  const result = planAutonomousPostMergeContinuation({
    checkpoint,
    freshSnapshot: continuationSnapshot(),
    currentIteration: 5,
    maxIterations: 5,
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "continuous_iteration_limit_reached");
});
