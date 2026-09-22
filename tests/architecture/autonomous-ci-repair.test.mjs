import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CODE_REPAIR_ATTEMPTS,
  MAX_TRANSIENT_RETRIES,
  buildCiFailureFingerprint,
  classifyAutonomousCiFailure,
  evaluateAutonomousRepairCandidate,
  evaluateAutonomousRepairLoopExit,
  planAutonomousCiRepair,
} from "../../scripts/autonomous-ci-repair.mjs";

const HEAD = "aaaaaaaaaaaaaaaa";
const BASE = "bbbbbbbbbbbbbbbb";

const failureSnapshot = (evidence = {}, overrides = {}) => ({
  expectedHeadSha: HEAD,
  workflowRun: {
    id: 100,
    name: "CI",
    headSha: HEAD,
    status: "completed",
    conclusion: "failure",
  },
  job: {
    id: 200,
    runId: 100,
    name: "Test shard 01",
    status: "completed",
    conclusion: "failure",
  },
  failedStep: {
    name: "Run shard",
    conclusion: "failure",
  },
  evidence: {
    logSignature: "AssertionError expected 200 received 500",
    productAssertionObserved: true,
    focusedReproduction: "fails",
    baseReproduction: "passes",
    validTestAssertion: true,
    sameHeadOutcomes: ["failure"],
    ...evidence,
  },
  ...overrides,
});

test("failure fingerprint is deterministic and does not retain raw log text", () => {
  const a = buildCiFailureFingerprint({
    workflowName: "CI",
    jobName: "Test shard 01",
    stepName: "Run shard",
    logSignature: "AssertionError   expected 200 received 500",
  });
  const b = buildCiFailureFingerprint({
    workflowName: "CI",
    jobName: "Test shard 01",
    stepName: "Run shard",
    logSignature: "AssertionError expected 200 received 500",
  });

  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(a, /AssertionError/u);
});

test("classifies a reproducible product regression on the exact head", () => {
  const result = classifyAutonomousCiFailure(failureSnapshot());
  assert.equal(result.classification, "REGRESSION");
  assert.equal(result.headSha, HEAD);
  assert.ok(result.fingerprint);
});

test("classifies a pre-existing exposed defect when base fails the same way", () => {
  const result = classifyAutonomousCiFailure(failureSnapshot({
    baseReproduction: "fails_same",
    validTestAssertion: true,
  }));
  assert.equal(result.classification, "EXPOSED_DEFECT");
});

test("classifies an invalid test only with canonical contract evidence", () => {
  const result = classifyAutonomousCiFailure(failureSnapshot({
    focusedReproduction: "fails",
    baseReproduction: "passes",
    validTestAssertion: false,
    testExpectationContradictsContract: true,
    canonicalContractReference: "docs/reference/API.md#changed-contract",
  }));
  assert.equal(result.classification, "INVALID_TEST");
});

test("classifies strong infrastructure evidence without product assertion as infrastructure", () => {
  const result = classifyAutonomousCiFailure(failureSnapshot({
    infrastructureSignal: "runner_unavailable",
    productAssertionObserved: false,
    focusedReproduction: "not_run",
    baseReproduction: "not_run",
    validTestAssertion: false,
  }, {
    job: {
      id: 200,
      runId: 100,
      name: "build",
      status: "completed",
      conclusion: "cancelled",
    },
  }));
  assert.equal(result.classification, "INFRASTRUCTURE");
});

test("classifies inconsistent same-head outcomes as flaky", () => {
  const result = classifyAutonomousCiFailure(failureSnapshot({
    productAssertionObserved: false,
    focusedReproduction: "not_run",
    baseReproduction: "not_run",
    validTestAssertion: false,
    sameHeadOutcomes: ["failure", "success"],
  }));
  assert.equal(result.classification, "FLAKY");
});

test("conflicting evidence fails closed as ambiguous", () => {
  const result = classifyAutonomousCiFailure(failureSnapshot({
    infrastructureSignal: "runner_unavailable",
    productAssertionObserved: false,
    focusedReproduction: "fails",
    baseReproduction: "passes",
    validTestAssertion: true,
  }));
  assert.equal(result.classification, "AMBIGUOUS");
  assert.ok(result.candidates.includes("INFRASTRUCTURE"));
  assert.ok(result.candidates.includes("REGRESSION"));
});

test("stale workflow head is never classified as a current repair target", () => {
  const result = classifyAutonomousCiFailure(failureSnapshot({}, {
    workflowRun: {
      id: 100,
      name: "CI",
      headSha: BASE,
      status: "completed",
      conclusion: "failure",
    },
  }));
  assert.equal(result.classification, "UNKNOWN");
  assert.equal(result.reason, "workflow_head_not_exact");
});

test("regression returns to implementation without permission to weaken tests", () => {
  const classification = classifyAutonomousCiFailure(failureSnapshot());
  const plan = planAutonomousCiRepair(classification);

  assert.equal(plan.decision, "REPAIR");
  assert.equal(plan.action.type, "RETURN_TO_IMPLEMENTATION");
  assert.equal(plan.action.testChangesAllowed, false);
  assert.equal(plan.action.validAssertionsMustNotBeWeakened, true);
  assert.equal(plan.action.focusedValidationRequiredBeforePush, true);
});

test("invalid test correction requires canonical contract review", () => {
  const classification = classifyAutonomousCiFailure(failureSnapshot({
    validTestAssertion: false,
    testExpectationContradictsContract: true,
    canonicalContractReference: "docs/reference/API.md#changed-contract",
  }));
  const plan = planAutonomousCiRepair(classification);

  assert.equal(plan.decision, "REPAIR");
  assert.equal(plan.action.testChangesAllowed, true);
  assert.equal(plan.action.canonicalContractReviewRequired, true);
  assert.equal(plan.action.validAssertionsMustNotBeWeakened, true);
});

test("exposed pre-existing defect does not silently expand current task scope", () => {
  const classification = classifyAutonomousCiFailure(failureSnapshot({
    baseReproduction: "fails_same",
  }));
  const plan = planAutonomousCiRepair(classification);

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reason, "pre_existing_defect_requires_coordinator_scope_decision");
});

test("transient failure gets only one exact-head retry", () => {
  const classification = classifyAutonomousCiFailure(failureSnapshot({
    productAssertionObserved: false,
    focusedReproduction: "not_run",
    baseReproduction: "not_run",
    validTestAssertion: false,
    transientSignal: "connection_reset",
  }));

  const first = planAutonomousCiRepair(classification);
  assert.equal(first.decision, "RETRY");
  assert.equal(first.action.type, "RETRY_EXACT_HEAD");
  assert.equal(first.action.expectedHeadSha, HEAD);
  assert.equal(first.action.codeChangesAllowed, false);

  const history = [first.audit];
  const second = planAutonomousCiRepair(classification, history);
  assert.equal(MAX_TRANSIENT_RETRIES, 1);
  assert.equal(second.decision, "BLOCKED");
  assert.equal(second.reason, "transient_retry_limit_exhausted");
});

test("repeated code-repair attempts eventually block", () => {
  const classification = classifyAutonomousCiFailure(failureSnapshot());
  const history = Array.from({ length: MAX_CODE_REPAIR_ATTEMPTS }, (_, index) => ({
    headSha: index === 0 ? HEAD : `ccccccccccccccc${index}`,
    fingerprint: classification.fingerprint,
    classification: "REGRESSION",
    action: "RETURN_TO_IMPLEMENTATION",
  }));

  const result = planAutonomousCiRepair(classification, history);
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.reason, "code_repair_attempt_limit_exhausted");
});

test("repair candidate must have a new head and exact-head focused evidence", () => {
  const candidate = "cccccccccccccccc";
  const result = evaluateAutonomousRepairCandidate({
    previousHeadSha: HEAD,
    candidateHeadSha: candidate,
    failureFingerprint: "fingerprint-1",
    focusedValidation: [
      { command: "node --test tests/foo.test.mjs", status: "success", headSha: candidate },
    ],
    finalDiffReview: { completed: true, blockingFindings: 0, headSha: candidate },
    repairSummary: "Fixed null handling without changing assertions.",
  });

  assert.equal(result.decision, "READY_FOR_CI");
  assert.equal(result.expectedHeadSha, candidate);
  assert.equal(result.nextAction, "PUSH_AND_WAIT_EXACT_HEAD_CI");
});

test("stale validation cannot authorize a repaired head", () => {
  const candidate = "cccccccccccccccc";
  const result = evaluateAutonomousRepairCandidate({
    previousHeadSha: HEAD,
    candidateHeadSha: candidate,
    failureFingerprint: "fingerprint-1",
    focusedValidation: [
      { command: "node --test tests/foo.test.mjs", status: "success", headSha: HEAD },
    ],
    finalDiffReview: { completed: true, blockingFindings: 0, headSha: HEAD },
    repairSummary: "Fix",
  });

  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("focused_validation_missing_red_or_stale"));
  assert.ok(result.reasons.includes("final_diff_review_incomplete_blocked_or_stale"));
});

test("exact-head green aggregates return to merge evaluation", () => {
  const result = evaluateAutonomousRepairLoopExit({
    expectedHeadSha: HEAD,
    requiredCi: { headSha: HEAD, status: "completed", conclusion: "success" },
    scopedE2E: { headSha: HEAD, status: "completed", conclusion: "success" },
  });
  assert.equal(result.decision, "READY_FOR_MERGE_EVALUATION");
});

test("red or mismatched post-repair checks never become green by policy", () => {
  const red = evaluateAutonomousRepairLoopExit({
    expectedHeadSha: HEAD,
    requiredCi: { headSha: HEAD, status: "completed", conclusion: "failure" },
    scopedE2E: { headSha: HEAD, status: "completed", conclusion: "success" },
  });
  assert.equal(red.decision, "REPAIR_REQUIRED");

  const stale = evaluateAutonomousRepairLoopExit({
    expectedHeadSha: HEAD,
    requiredCi: { headSha: BASE, status: "completed", conclusion: "success" },
    scopedE2E: { headSha: HEAD, status: "completed", conclusion: "success" },
  });
  assert.equal(stale.decision, "BLOCKED");
  assert.equal(stale.reason, "post_repair_check_head_mismatch");
});
