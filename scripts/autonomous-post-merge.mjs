import { classifyAutonomousTaskIssue } from "./autonomous-task-state.mjs";
import { selectNextAutonomousTask } from "./autonomous-task-selector.mjs";

export const AUTONOMOUS_POST_MERGE_CONTRACT_VERSION = 1;
export const DEFAULT_MAX_CONTINUOUS_ITERATIONS = 5;

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOutcome(value) {
  return String(value ?? "").trim().toLowerCase();
}

function issueNumber(issue) {
  const value = Number(issue?.number ?? issue?.issue_number);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function inspectPostMergeCheck(name, check, expectedMainSha) {
  if (!check || typeof check !== "object") {
    return { state: "BLOCKED", reason: `post_merge_check_missing:${name}` };
  }
  if (normalizeSha(check.headSha) !== expectedMainSha) {
    return { state: "BLOCKED", reason: `post_merge_check_stale:${name}` };
  }
  const status = normalizeOutcome(check.status);
  const conclusion = normalizeOutcome(check.conclusion);
  if (status !== "completed") {
    return { state: "WAIT", reason: `post_merge_check_pending:${name}` };
  }
  if (conclusion !== "success") {
    return { state: "RED", reason: `post_merge_check_not_green:${name}` };
  }
  return { state: "GREEN", reason: null };
}

function unique(values) {
  return Object.freeze(Array.from(new Set(values)));
}

export function evaluateAutonomousPostMergeCheckpoint(snapshot) {
  const currentMainSha = normalizeSha(snapshot?.currentMainSha);
  if (currentMainSha.length < 7) {
    return {
      decision: "BLOCKED",
      reason: "invalid_current_main",
      reasons: ["invalid_current_main"],
      transition: null,
    };
  }

  const issue = snapshot?.issue;
  const number = issueNumber(issue);
  if (number === null) {
    return {
      decision: "BLOCKED",
      reason: "invalid_issue",
      reasons: ["invalid_issue"],
      transition: null,
      mainSha: currentMainSha,
    };
  }

  const classified = classifyAutonomousTaskIssue(issue);
  const reasons = [];
  const pending = [];
  const redChecks = [];

  if (!classified.managed || !classified.valid || classified.state !== "REVIEW") {
    reasons.push("task_not_in_valid_review_state");
  }

  const merge = snapshot?.mergeEvidence ?? {};
  if (merge.merged !== true) reasons.push("merge_not_confirmed");
  if (normalizeSha(merge.mergeCommitSha) !== currentMainSha) {
    reasons.push("resulting_main_does_not_match_merge");
  }
  if (Number(merge.issue) !== number) reasons.push("merge_issue_mismatch");
  if (!Number.isInteger(Number(merge.pullRequest)) || Number(merge.pullRequest) <= 0) {
    reasons.push("merged_pull_request_missing");
  }
  if (merge.changePresent !== true) reasons.push("merged_change_not_verified_present");
  if (normalizeSha(merge.changeVerifiedOnMainSha) !== currentMainSha) {
    reasons.push("merged_change_verification_stale");
  }

  const acceptance = snapshot?.acceptance ?? {};
  if (
    acceptance.completed !== true
    || acceptance.satisfied !== true
    || normalizeSha(acceptance.mainSha) !== currentMainSha
  ) {
    reasons.push("post_merge_acceptance_not_satisfied_or_stale");
  }

  for (const [name, check] of [
    ["Required CI", snapshot?.checks?.requiredCi],
    ["scoped-e2e", snapshot?.checks?.scopedE2E],
  ]) {
    const result = inspectPostMergeCheck(name, check, currentMainSha);
    if (result.state === "WAIT") pending.push(result.reason);
    if (result.state === "BLOCKED") reasons.push(result.reason);
    if (result.state === "RED") redChecks.push(result.reason);
  }

  if (reasons.length > 0) {
    return {
      decision: "BLOCKED",
      reason: "post_merge_evidence_incomplete_or_stale",
      reasons: unique(reasons),
      pending: unique(pending),
      redChecks: unique(redChecks),
      transition: null,
      mainSha: currentMainSha,
      issue: number,
    };
  }

  if (redChecks.length > 0) {
    return {
      decision: "REGRESSION_BLOCKED",
      reason: "resulting_main_not_healthy",
      reasons: [],
      pending: unique(pending),
      redChecks: unique(redChecks),
      transition: null,
      mainSha: currentMainSha,
      issue: number,
      nextAction: "BOUNDED_HOTFIX_OR_REVERT",
    };
  }

  if (pending.length > 0) {
    return {
      decision: "WAIT",
      reason: "post_merge_checks_pending",
      reasons: [],
      pending: unique(pending),
      redChecks: [],
      transition: null,
      mainSha: currentMainSha,
      issue: number,
    };
  }

  return {
    decision: "VERIFIED_CHECKPOINT",
    reason: "resulting_main_healthy_and_acceptance_satisfied",
    reasons: [],
    pending: [],
    redChecks: [],
    mainSha: currentMainSha,
    issue: number,
    pullRequest: Number(merge.pullRequest),
    transition: Object.freeze({
      issue: number,
      from: "REVIEW",
      to: "DONE",
      githubState: "closed",
      stateReason: "completed",
    }),
    nextAction: "CLOSE_ISSUE_THEN_REFRESH_GITHUB_STATE",
    evidence: Object.freeze({
      contractVersion: AUTONOMOUS_POST_MERGE_CONTRACT_VERSION,
      mainSha: currentMainSha,
      mergeCommitSha: normalizeSha(merge.mergeCommitSha),
      pullRequest: Number(merge.pullRequest),
    }),
  };
}

function stop(reason, details = {}) {
  return {
    decision: "STOP",
    reason,
    selected: null,
    ...details,
  };
}

export function planAutonomousPostMergeContinuation({
  checkpoint,
  freshSnapshot,
  currentIteration = 1,
  maxIterations = DEFAULT_MAX_CONTINUOUS_ITERATIONS,
}) {
  const iteration = Number(currentIteration);
  const limit = Number(maxIterations);

  if (checkpoint?.decision !== "VERIFIED_CHECKPOINT") {
    return stop("checkpoint_not_verified");
  }
  if (!Number.isInteger(iteration) || iteration <= 0) {
    return stop("invalid_iteration");
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    return stop("invalid_iteration_limit");
  }
  if (iteration >= limit) {
    return stop("continuous_iteration_limit_reached", {
      iteration,
      maxIterations: limit,
    });
  }

  if (
    !freshSnapshot
    || freshSnapshot.githubAvailable !== true
    || freshSnapshot.refreshPhase !== "after_issue_close"
  ) {
    return stop("fresh_post_close_github_snapshot_required");
  }

  const mainSha = normalizeSha(checkpoint.mainSha);
  if (normalizeSha(freshSnapshot.mainSha) !== mainSha) {
    return stop("fresh_snapshot_main_mismatch");
  }

  const completedIssue = (freshSnapshot.issues ?? []).find(
    (issue) => issueNumber(issue) === Number(checkpoint.issue),
  );
  if (!completedIssue) {
    return stop("completed_issue_missing_from_fresh_snapshot");
  }

  const completedState = classifyAutonomousTaskIssue(completedIssue);
  if (
    !completedState.managed
    || !completedState.valid
    || completedState.state !== "DONE"
  ) {
    return stop("current_issue_not_confirmed_done_after_close", {
      observedState: completedState.state,
    });
  }

  const selectorDecision = selectNextAutonomousTask(freshSnapshot);
  if (selectorDecision.decision === "SELECTED") {
    return {
      decision: "CONTINUE",
      reason: "fresh_selector_selected_next_issue",
      selected: selectorDecision.selected,
      selectorDecision,
      mainSha,
      nextIteration: iteration + 1,
      maxIterations: limit,
    };
  }

  if (selectorDecision.decision === "NO_WORK") {
    return stop("no_executable_ready_work", {
      selectorDecision,
      mainSha,
      iteration,
      maxIterations: limit,
    });
  }

  return stop("selector_blocked_or_requires_human_action", {
    selectorDecision,
    mainSha,
    iteration,
    maxIterations: limit,
  });
}
