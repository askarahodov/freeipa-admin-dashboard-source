import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTONOMOUS_REQUIRED_PROTECTION_CHECKS,
  evaluateAutonomousMergeGate,
} from "../../scripts/autonomous-merge-gate.mjs";

const HEAD = "aaaaaaaaaaaaaaaa";
const BASE = "bbbbbbbbbbbbbbbb";

const greenCheck = () => ({
  headSha: HEAD,
  status: "completed",
  conclusion: "success",
});

const validSnapshot = (overrides = {}) => ({
  expectedHeadSha: HEAD,
  currentMainSha: BASE,
  validatedBaseSha: BASE,
  taskState: "REVIEW",
  repositoryProtection: {
    enforced: true,
    pullRequestRequired: true,
    forcePushBlocked: true,
    deletionBlocked: true,
    ordinaryBypassAllowed: false,
    requiredCheckNames: [...AUTONOMOUS_REQUIRED_PROTECTION_CHECKS],
  },
  pullRequest: {
    state: "open",
    draft: false,
    mergeable: true,
    base: "main",
    baseSha: BASE,
    headSha: HEAD,
  },
  checks: {
    requiredCi: greenCheck(),
    scopedE2E: greenCheck(),
    collisionGuard: greenCheck(),
  },
  evidence: {
    prCheckpoint: {
      decision: "REVIEW_CONFIRMED",
      headSha: HEAD,
    },
    acceptanceReview: {
      completed: true,
      satisfied: true,
      headSha: HEAD,
    },
    focusedValidation: {
      completed: true,
      status: "success",
      headSha: HEAD,
    },
    review: {
      completed: true,
      blockingFindings: 0,
      unresolvedThreads: 0,
      securityBlockingFindings: 0,
      headSha: HEAD,
    },
    documentationImpact: {
      decision: "not_required",
      headSha: HEAD,
    },
    dependencies: {
      resolved: true,
    },
    rollback: {
      required: false,
    },
  },
  ...overrides,
});

test("authorizes only an exact-head fully satisfied protected repository contract", () => {
  const result = evaluateAutonomousMergeGate(validSnapshot());
  assert.equal(result.decision, "READY_FOR_MERGE");
  assert.equal(result.expectedHeadSha, HEAD);
  assert.equal(result.authorization.expectedHeadSha, HEAD);
  assert.equal(result.authorization.expectedBaseSha, BASE);
  assert.equal(result.authorization.forceAllowed, false);
  assert.equal(result.authorization.bypassAllowed, false);
});

test("repository protection is an explicit prerequisite", () => {
  const snapshot = validSnapshot();
  snapshot.repositoryProtection.enforced = false;
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "PROTECTION_REQUIRED");
  assert.equal(result.reason, "repository_protection_not_enforced");
  assert.equal(result.authorization, null);
});

test("incompatible protection configuration fails closed", () => {
  const snapshot = validSnapshot();
  snapshot.repositoryProtection.requiredCheckNames = ["Required CI"];
  snapshot.repositoryProtection.ordinaryBypassAllowed = true;
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "PROTECTION_REQUIRED");
  assert.ok(result.reasons.includes("required_protection_check_missing:scoped-e2e"));
  assert.ok(result.reasons.includes("ordinary_bypass_not_disabled"));
});

test("pending required check returns WAIT rather than merge authorization", () => {
  const snapshot = validSnapshot();
  snapshot.checks.scopedE2E = { headSha: HEAD, status: "in_progress", conclusion: null };
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "WAIT");
  assert.ok(result.pending.includes("required_check_pending:scoped-e2e"));
});

test("failed required CI blocks merge", () => {
  const snapshot = validSnapshot();
  snapshot.checks.requiredCi = { headSha: HEAD, status: "completed", conclusion: "failure" };
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("required_check_not_green:Required CI"));
});

test("skipped required check blocks merge", () => {
  const snapshot = validSnapshot();
  snapshot.checks.scopedE2E = { headSha: HEAD, status: "completed", conclusion: "skipped" };
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("required_check_skipped:scoped-e2e"));
});

test("stale exact-head evidence blocks merge", () => {
  const snapshot = validSnapshot();
  snapshot.checks.requiredCi.headSha = "cccccccccccccccc";
  snapshot.evidence.review.headSha = "cccccccccccccccc";
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("required_check_stale:Required CI"));
  assert.ok(result.reasons.includes("review_or_security_findings_unresolved_or_stale"));
});

test("base advancement after validation blocks merge", () => {
  const snapshot = validSnapshot({ currentMainSha: "cccccccccccccccc" });
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("base_advanced_after_validation"));
});

test("collision guard must be exact-head green", () => {
  const snapshot = validSnapshot();
  snapshot.checks.collisionGuard = { headSha: HEAD, status: "completed", conclusion: "failure" };
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("required_check_not_green:PR Collision Guard"));
});

test("unresolved review or security finding blocks merge despite green CI", () => {
  const snapshot = validSnapshot();
  snapshot.evidence.review.unresolvedThreads = 1;
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("review_or_security_findings_unresolved_or_stale"));
});

test("missing focused or acceptance evidence blocks merge", () => {
  const snapshot = validSnapshot();
  snapshot.evidence.focusedValidation = null;
  snapshot.evidence.acceptanceReview.satisfied = false;
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("focused_validation_missing_red_or_stale"));
  assert.ok(result.reasons.includes("acceptance_not_satisfied_or_stale"));
});

test("risky change requires exact-head rollback or recovery evidence", () => {
  const snapshot = validSnapshot();
  snapshot.evidence.rollback = {
    required: true,
    completed: false,
    headSha: HEAD,
  };
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("rollback_recovery_evidence_missing_or_stale"));
});

test("green CI cannot bypass a non-review task state or stale PR checkpoint", () => {
  const snapshot = validSnapshot({ taskState: "IN_PROGRESS" });
  snapshot.evidence.prCheckpoint.headSha = "cccccccccccccccc";
  const result = evaluateAutonomousMergeGate(snapshot);
  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("task_not_in_review_state"));
  assert.ok(result.reasons.includes("pr_checkpoint_missing_or_stale"));
});
