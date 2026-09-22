import { classifyAutonomousTaskIssue } from "./autonomous-task-state.mjs";

export const AUTONOMOUS_EXECUTION_CONTRACT_VERSION = 1;

export const AUTONOMOUS_EXECUTION_POLICY_PATHS = Object.freeze([
  "AGENTS.md",
  "docs/ai/AI_AGENT_WORKFLOW.md",
  "docs/TESTING_POLICY.md",
  ".github/pull_request_template.md",
  "docs/ai/AUTONOMOUS_TASK_STATE.md",
  "docs/ai/AUTONOMOUS_TASK_SELECTOR.md",
]);

function issueNumber(issue) {
  const value = Number(issue?.number ?? issue?.issue_number);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeRef(value) {
  return String(value ?? "").trim().replace(/^refs\/heads\//u, "");
}

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePrState(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function autonomousClaimBranchName(number) {
  const normalized = Number(number);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new TypeError("issue number must be a positive integer");
  }
  return `agent/task-${normalized}`;
}

function findClaimBranch(branches, branchName) {
  return (branches ?? []).find((entry) => normalizeRef(entry?.name) === branchName) ?? null;
}

function findClaimPullRequest(openPullRequests, branchName) {
  return (openPullRequests ?? []).find((pullRequest) => (
    normalizePrState(pullRequest?.state) === "open"
    && normalizeRef(pullRequest?.head) === branchName
    && normalizeRef(pullRequest?.base) === "main"
  )) ?? null;
}

function block(reason, details = {}) {
  return {
    decision: "BLOCKED",
    reason,
    claim: null,
    ...details,
  };
}

function selectorMatchesFreshMain(selectorDecision, issueNo, mainSha) {
  return (
    selectorDecision?.decision === "SELECTED"
    && Number(selectorDecision?.selected?.issue) === issueNo
    && normalizeSha(selectorDecision?.evidence?.mainSha) === normalizeSha(mainSha)
  );
}

export function planAutonomousExecutionClaim(snapshot, selectedIssueNumber) {
  const selected = Number(selectedIssueNumber);
  if (!Number.isInteger(selected) || selected <= 0) {
    return block("invalid_selected_issue");
  }
  if (!snapshot || snapshot.githubAvailable !== true) {
    return block("github_state_unavailable");
  }
  if (typeof snapshot.mainSha !== "string" || snapshot.mainSha.length < 7) {
    return block("invalid_main_snapshot");
  }
  if (!Array.isArray(snapshot.branches) || !Array.isArray(snapshot.openPullRequests)) {
    return block("incomplete_execution_snapshot");
  }
  if (!selectorMatchesFreshMain(snapshot.selectorDecision, selected, snapshot.mainSha)) {
    return block("stale_or_mismatched_selector_decision");
  }

  const issue = snapshot.issue;
  if (issueNumber(issue) !== selected) {
    return block("selected_issue_payload_mismatch");
  }

  const classified = classifyAutonomousTaskIssue(issue);
  if (!classified.managed || !classified.valid) {
    return block("invalid_task_state", { errors: classified.errors ?? [] });
  }
  if (classified.metadata?.humanApprovalRequired === true) {
    return block("human_approval_required");
  }

  const branchName = autonomousClaimBranchName(selected);
  const existingBranch = findClaimBranch(snapshot.branches, branchName);
  const existingPr = findClaimPullRequest(snapshot.openPullRequests, branchName);

  if (classified.state === "BLOCKED") {
    return block("task_state_blocked");
  }
  if (classified.state === "DONE" || classified.state === "CANCELLED") {
    return block("task_already_terminal", { state: classified.state });
  }

  if (existingBranch) {
    if (classified.state === "READY") {
      return {
        decision: "RECOVER_CLAIM",
        reason: "deterministic_claim_branch_already_exists",
        claim: {
          issue: selected,
          branch: branchName,
          branchSha: normalizeSha(existingBranch.sha),
          baseRef: "main",
          selectedMainSha: normalizeSha(snapshot.mainSha),
          pullRequest: existingPr ? Number(existingPr.number) : null,
          requiredStateTransition: "IN_PROGRESS",
        },
      };
    }

    if (classified.state === "IN_PROGRESS") {
      return {
        decision: existingPr ? "RESUME_PR_CHECKPOINT" : "RESUME_IMPLEMENTATION",
        reason: existingPr ? "existing_claim_and_open_pr" : "existing_claim_branch",
        claim: {
          issue: selected,
          branch: branchName,
          branchSha: normalizeSha(existingBranch.sha),
          baseRef: "main",
          selectedMainSha: normalizeSha(snapshot.mainSha),
          pullRequest: existingPr ? Number(existingPr.number) : null,
          requiredStateTransition: null,
        },
      };
    }

    if (classified.state === "REVIEW" && existingPr) {
      return {
        decision: "RESUME_REVIEW",
        reason: "review_state_with_existing_claim_pr",
        claim: {
          issue: selected,
          branch: branchName,
          branchSha: normalizeSha(existingBranch.sha),
          baseRef: "main",
          selectedMainSha: normalizeSha(snapshot.mainSha),
          pullRequest: Number(existingPr.number),
          requiredStateTransition: null,
        },
      };
    }

    return block("inconsistent_claim_state", {
      state: classified.state,
      branch: branchName,
      pullRequest: existingPr ? Number(existingPr.number) : null,
    });
  }

  if (classified.state !== "READY") {
    return block("task_not_ready_for_new_claim", { state: classified.state });
  }
  if (snapshot.collisionStatus !== "clean") {
    return block(
      snapshot.collisionStatus === "collision"
        ? "active_ownership_collision"
        : "collision_evidence_not_clean",
      { collision: snapshot.collisionStatus ?? "missing" },
    );
  }

  return {
    decision: "CLAIM_NEW",
    reason: "ready_issue_with_fresh_selector_and_clean_collision",
    claim: {
      issue: selected,
      branch: branchName,
      branchSha: normalizeSha(snapshot.mainSha),
      baseRef: "main",
      selectedMainSha: normalizeSha(snapshot.mainSha),
      pullRequest: null,
      requiredStateTransition: "IN_PROGRESS",
      mutationOrder: Object.freeze([
        "create_exact_branch_ref",
        "refetch_issue_and_branch",
        "transition_issue_to_in_progress",
      ]),
    },
  };
}

export function buildAutonomousExecutionContext({ issue, claim }) {
  const number = issueNumber(issue);
  if (number === null || Number(claim?.issue) !== number) {
    throw new TypeError("claim must match the execution issue");
  }
  const expectedBranch = autonomousClaimBranchName(number);
  if (normalizeRef(claim?.branch) !== expectedBranch) {
    throw new TypeError("claim branch does not match the canonical issue branch");
  }

  return Object.freeze({
    contractVersion: AUTONOMOUS_EXECUTION_CONTRACT_VERSION,
    issue: Object.freeze({
      number,
      title: String(issue?.title ?? ""),
      body: String(issue?.body ?? ""),
    }),
    base: Object.freeze({
      ref: "main",
      selectedSha: normalizeSha(claim?.selectedMainSha),
    }),
    branch: expectedBranch,
    policyPaths: AUTONOMOUS_EXECUTION_POLICY_PATHS,
    requirements: Object.freeze({
      directMainWritesAllowed: false,
      freshCollisionRecheckBeforeImplementation: true,
      focusedValidationRequired: true,
      finalCombinedDiffReviewRequired: true,
      documentationImpactDecisionRequired: true,
      pullRequestEvidenceRequired: true,
    }),
  });
}

function validateFocusedValidation(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.every((row) => (
    typeof row?.command === "string"
    && row.command.trim().length > 0
    && row?.status === "success"
  ));
}

function checkpointBlock(reasons) {
  return {
    decision: "BLOCKED",
    reason: "pr_checkpoint_evidence_incomplete",
    transition: null,
    reasons: Object.freeze(Array.from(new Set(reasons)).sort()),
  };
}

export function evaluateAutonomousPrCheckpoint({
  issue,
  branch,
  pullRequest,
  collisionStatus,
  evidence,
}) {
  const number = issueNumber(issue);
  if (number === null) return checkpointBlock(["invalid_issue_number"]);

  const classified = classifyAutonomousTaskIssue(issue);
  if (!classified.managed || !classified.valid) {
    return checkpointBlock(["invalid_task_state"]);
  }
  if (!["IN_PROGRESS", "REVIEW"].includes(classified.state)) {
    return checkpointBlock(["task_not_in_execution_or_review_state"]);
  }

  const expectedBranch = autonomousClaimBranchName(number);
  const reasons = [];

  if (normalizeRef(branch?.name) !== expectedBranch) reasons.push("claim_branch_mismatch");
  if (!normalizeSha(branch?.sha)) reasons.push("missing_claim_branch_sha");

  if (
    normalizePrState(pullRequest?.state) !== "open"
    || normalizeRef(pullRequest?.base) !== "main"
    || normalizeRef(pullRequest?.head) !== expectedBranch
    || !Number.isInteger(Number(pullRequest?.number))
  ) {
    reasons.push("invalid_or_missing_pull_request");
  }

  if (collisionStatus !== "clean") reasons.push("collision_recheck_not_clean");
  if (!validateFocusedValidation(evidence?.focusedValidation)) {
    reasons.push("focused_validation_missing_or_red");
  }
  if (
    evidence?.finalDiffReview?.completed !== true
    || Number(evidence?.finalDiffReview?.blockingFindings ?? 0) !== 0
  ) {
    reasons.push("final_diff_review_incomplete_or_blocked");
  }

  const docsDecision = evidence?.documentationImpact?.decision;
  if (!["updated", "not_required"].includes(docsDecision)) {
    reasons.push("documentation_impact_not_decided");
  }
  if (
    docsDecision === "not_required"
    && String(evidence?.documentationImpact?.notes ?? "").trim().length === 0
  ) {
    reasons.push("documentation_no_impact_reason_missing");
  }

  if (evidence?.acceptanceReviewCompleted !== true) {
    reasons.push("acceptance_review_missing");
  }
  if (evidence?.sourceOfTruthReviewCompleted !== true) {
    reasons.push("source_of_truth_review_missing");
  }

  const prEvidence = evidence?.prEvidence ?? {};
  for (const field of [
    "validationRecorded",
    "securityOperationalImpactReviewed",
    "documentationImpactRecorded",
    "coordinationRecorded",
    "sourceOfTruthRecorded",
    "rollbackRecorded",
  ]) {
    if (prEvidence[field] !== true) reasons.push(`pr_evidence_missing:${field}`);
  }

  if (reasons.length > 0) return checkpointBlock(reasons);

  if (classified.state === "REVIEW") {
    return {
      decision: "REVIEW_CONFIRMED",
      reason: "pr_checkpoint_already_satisfied",
      transition: null,
      pullRequest: Number(pullRequest.number),
      branch: expectedBranch,
    };
  }

  return {
    decision: "READY_FOR_REVIEW",
    reason: "pr_checkpoint_evidence_satisfied",
    transition: Object.freeze({
      from: "IN_PROGRESS",
      to: "REVIEW",
    }),
    pullRequest: Number(pullRequest.number),
    branch: expectedBranch,
  };
}
