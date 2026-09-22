import assert from "node:assert/strict";
import test from "node:test";

import { formatAutonomousTaskMarker } from "../../scripts/autonomous-task-state.mjs";
import {
  autonomousClaimBranchName,
  buildAutonomousExecutionContext,
  evaluateAutonomousPrCheckpoint,
  planAutonomousExecutionClaim,
} from "../../scripts/autonomous-execution-contract.mjs";

const managed = (number, {
  label = "ai:ready",
  humanApprovalRequired = false,
} = {}) => ({
  number,
  state: "open",
  labels: [label],
  title: `Issue ${number}`,
  body: `## Goal\nBounded work.\n\n${formatAutonomousTaskMarker({
    priority: "P1",
    dependsOn: [],
    humanApprovalRequired,
  })}`,
});

const selected = (number, mainSha = "abcdef0123456789") => ({
  decision: "SELECTED",
  selected: { issue: number, priority: "P1" },
  evidence: { mainSha },
});

const claimSnapshot = (issue, overrides = {}) => ({
  githubAvailable: true,
  mainSha: "abcdef0123456789",
  selectorDecision: selected(issue.number),
  issue,
  branches: [],
  openPullRequests: [],
  collisionStatus: "clean",
  ...overrides,
});

const fullEvidence = () => ({
  focusedValidation: [
    { command: "node --test tests/architecture/autonomous-execution-contract.test.mjs", status: "success" },
  ],
  finalDiffReview: { completed: true, blockingFindings: 0 },
  documentationImpact: { decision: "updated", notes: "Execution contract docs updated." },
  acceptanceReviewCompleted: true,
  sourceOfTruthReviewCompleted: true,
  prEvidence: {
    validationRecorded: true,
    securityOperationalImpactReviewed: true,
    documentationImpactRecorded: true,
    coordinationRecorded: true,
    sourceOfTruthRecorded: true,
    rollbackRecorded: true,
  },
});

test("canonical claim branch is deterministic per Issue", () => {
  assert.equal(autonomousClaimBranchName(683), "agent/task-683");
  assert.throws(() => autonomousClaimBranchName(0), /positive integer/u);
});

test("fresh READY issue produces atomic branch-first claim plan", () => {
  const issue = managed(683);
  const result = planAutonomousExecutionClaim(claimSnapshot(issue), 683);

  assert.equal(result.decision, "CLAIM_NEW");
  assert.equal(result.claim.branch, "agent/task-683");
  assert.equal(result.claim.branchSha, "abcdef0123456789");
  assert.equal(result.claim.requiredStateTransition, "IN_PROGRESS");
  assert.deepEqual(result.claim.mutationOrder, [
    "create_exact_branch_ref",
    "refetch_issue_and_branch",
    "transition_issue_to_in_progress",
  ]);
});

test("stale selector decision cannot claim fresh main", () => {
  const issue = managed(683);
  const result = planAutonomousExecutionClaim(
    claimSnapshot(issue, {
      mainSha: "bbbbbb0123456789",
      selectorDecision: selected(683, "aaaaaa0123456789"),
    }),
    683,
  );

  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.reason, "stale_or_mismatched_selector_decision");
});

test("existing deterministic branch prevents duplicate claim and enables recovery", () => {
  const issue = managed(683);
  const result = planAutonomousExecutionClaim(
    claimSnapshot(issue, {
      branches: [{ name: "agent/task-683", sha: "1234567890abcdef" }],
    }),
    683,
  );

  assert.equal(result.decision, "RECOVER_CLAIM");
  assert.equal(result.claim.branch, "agent/task-683");
  assert.equal(result.claim.requiredStateTransition, "IN_PROGRESS");
});

test("IN_PROGRESS issue with existing claim branch resumes implementation", () => {
  const issue = managed(683, { label: "ai:in-progress" });
  const result = planAutonomousExecutionClaim(
    claimSnapshot(issue, {
      branches: [{ name: "agent/task-683", sha: "1234567890abcdef" }],
    }),
    683,
  );

  assert.equal(result.decision, "RESUME_IMPLEMENTATION");
  assert.equal(result.claim.requiredStateTransition, null);
});

test("existing open PR makes an IN_PROGRESS retry resume the PR checkpoint", () => {
  const issue = managed(683, { label: "ai:in-progress" });
  const result = planAutonomousExecutionClaim(
    claimSnapshot(issue, {
      branches: [{ name: "agent/task-683", sha: "1234567890abcdef" }],
      openPullRequests: [{
        number: 700,
        state: "open",
        base: "main",
        head: "agent/task-683",
      }],
    }),
    683,
  );

  assert.equal(result.decision, "RESUME_PR_CHECKPOINT");
  assert.equal(result.claim.pullRequest, 700);
});

test("human approval and collision both fail closed before a new claim", () => {
  const approval = planAutonomousExecutionClaim(
    claimSnapshot(managed(683, { humanApprovalRequired: true })),
    683,
  );
  assert.equal(approval.reason, "human_approval_required");

  const collision = planAutonomousExecutionClaim(
    claimSnapshot(managed(683), { collisionStatus: "collision" }),
    683,
  );
  assert.equal(collision.reason, "active_ownership_collision");
});

test("execution context carries issue, exact base, branch and policy owners", () => {
  const issue = managed(683);
  const claim = planAutonomousExecutionClaim(claimSnapshot(issue), 683).claim;
  const context = buildAutonomousExecutionContext({ issue, claim });

  assert.equal(context.issue.number, 683);
  assert.equal(context.base.selectedSha, "abcdef0123456789");
  assert.equal(context.branch, "agent/task-683");
  assert.equal(context.requirements.directMainWritesAllowed, false);
  assert.ok(context.policyPaths.includes("docs/TESTING_POLICY.md"));
  assert.ok(context.policyPaths.includes(".github/pull_request_template.md"));
});

test("PR checkpoint blocks REVIEW when focused validation is missing", () => {
  const issue = managed(683, { label: "ai:in-progress" });
  const evidence = fullEvidence();
  evidence.focusedValidation = [];

  const result = evaluateAutonomousPrCheckpoint({
    issue,
    branch: { name: "agent/task-683", sha: "1234567890abcdef" },
    pullRequest: { number: 700, state: "open", base: "main", head: "agent/task-683" },
    collisionStatus: "clean",
    evidence,
  });

  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("focused_validation_missing_or_red"));
});

test("PR checkpoint blocks REVIEW on unresolved diff or documentation evidence", () => {
  const issue = managed(683, { label: "ai:in-progress" });
  const evidence = fullEvidence();
  evidence.finalDiffReview.blockingFindings = 1;
  evidence.documentationImpact = { decision: "not_required", notes: "" };

  const result = evaluateAutonomousPrCheckpoint({
    issue,
    branch: { name: "agent/task-683", sha: "1234567890abcdef" },
    pullRequest: { number: 700, state: "open", base: "main", head: "agent/task-683" },
    collisionStatus: "clean",
    evidence,
  });

  assert.equal(result.decision, "BLOCKED");
  assert.ok(result.reasons.includes("final_diff_review_incomplete_or_blocked"));
  assert.ok(result.reasons.includes("documentation_no_impact_reason_missing"));
});

test("complete PR checkpoint permits only IN_PROGRESS -> REVIEW transition", () => {
  const issue = managed(683, { label: "ai:in-progress" });

  const result = evaluateAutonomousPrCheckpoint({
    issue,
    branch: { name: "agent/task-683", sha: "1234567890abcdef" },
    pullRequest: { number: 700, state: "open", base: "main", head: "agent/task-683" },
    collisionStatus: "clean",
    evidence: fullEvidence(),
  });

  assert.equal(result.decision, "READY_FOR_REVIEW");
  assert.deepEqual(result.transition, { from: "IN_PROGRESS", to: "REVIEW" });
  assert.equal(result.pullRequest, 700);
});

test("retrying an already valid REVIEW checkpoint is idempotent", () => {
  const issue = managed(683, { label: "ai:review" });

  const result = evaluateAutonomousPrCheckpoint({
    issue,
    branch: { name: "agent/task-683", sha: "1234567890abcdef" },
    pullRequest: { number: 700, state: "open", base: "main", head: "agent/task-683" },
    collisionStatus: "clean",
    evidence: fullEvidence(),
  });

  assert.equal(result.decision, "REVIEW_CONFIRMED");
  assert.equal(result.transition, null);
});
