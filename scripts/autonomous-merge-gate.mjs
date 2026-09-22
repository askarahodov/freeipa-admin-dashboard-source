export const AUTONOMOUS_MERGE_GATE_CONTRACT_VERSION = 1;

export const AUTONOMOUS_REQUIRED_PROTECTION_CHECKS = Object.freeze([
  "Required CI",
  "scoped-e2e",
]);

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeOutcome(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueReasons(reasons) {
  return Object.freeze(Array.from(new Set(reasons)));
}

function protectionDecision(protection) {
  if (!protection || protection.enforced !== true) {
    return {
      ok: false,
      reason: "repository_protection_not_enforced",
      reasons: ["main_not_protected"],
    };
  }

  const reasons = [];
  if (protection.pullRequestRequired !== true) reasons.push("pull_request_not_required");
  if (protection.forcePushBlocked !== true) reasons.push("force_push_not_blocked");
  if (protection.deletionBlocked !== true) reasons.push("branch_deletion_not_blocked");
  if (protection.ordinaryBypassAllowed !== false) reasons.push("ordinary_bypass_not_disabled");

  const checks = new Set(
    Array.isArray(protection.requiredCheckNames)
      ? protection.requiredCheckNames.map((value) => normalizeText(value)).filter(Boolean)
      : [],
  );
  for (const required of AUTONOMOUS_REQUIRED_PROTECTION_CHECKS) {
    if (!checks.has(required)) reasons.push(`required_protection_check_missing:${required}`);
  }

  return reasons.length > 0
    ? {
        ok: false,
        reason: "repository_protection_incompatible",
        reasons: uniqueReasons(reasons),
      }
    : { ok: true, reason: "repository_protection_compatible", reasons: [] };
}

function exactHeadEvidence(value, expectedHeadSha) {
  return normalizeSha(value) === normalizeSha(expectedHeadSha);
}

function inspectRequiredCheck(name, check, expectedHeadSha) {
  if (!check || typeof check !== "object") {
    return { state: "BLOCKED", reason: `required_check_missing:${name}` };
  }
  if (!exactHeadEvidence(check.headSha, expectedHeadSha)) {
    return { state: "BLOCKED", reason: `required_check_stale:${name}` };
  }

  const status = normalizeOutcome(check.status);
  const conclusion = normalizeOutcome(check.conclusion);
  if (status !== "completed") {
    return { state: "WAIT", reason: `required_check_pending:${name}` };
  }
  if (conclusion !== "success") {
    return {
      state: "BLOCKED",
      reason: conclusion === "skipped"
        ? `required_check_skipped:${name}`
        : `required_check_not_green:${name}`,
    };
  }
  return { state: "GREEN", reason: null };
}

export function evaluateAutonomousMergeGate(snapshot) {
  const expectedHeadSha = normalizeSha(snapshot?.expectedHeadSha);
  if (expectedHeadSha.length < 7) {
    return {
      decision: "BLOCKED",
      reason: "invalid_expected_head",
      reasons: ["invalid_expected_head"],
      authorization: null,
    };
  }

  const protection = protectionDecision(snapshot?.repositoryProtection);
  if (!protection.ok) {
    return {
      decision: "PROTECTION_REQUIRED",
      reason: protection.reason,
      reasons: protection.reasons,
      authorization: null,
      expectedHeadSha,
    };
  }

  const reasons = [];
  const pending = [];
  const pullRequest = snapshot?.pullRequest ?? {};

  if (normalizeOutcome(pullRequest.state) !== "open") reasons.push("pull_request_not_open");
  if (pullRequest.draft === true) reasons.push("pull_request_is_draft");
  if (pullRequest.mergeable !== true) reasons.push("pull_request_not_mergeable");
  if (normalizeText(pullRequest.base) !== "main") reasons.push("pull_request_base_not_main");
  if (!exactHeadEvidence(pullRequest.headSha, expectedHeadSha)) reasons.push("pull_request_head_not_exact");

  const currentMainSha = normalizeSha(snapshot?.currentMainSha);
  const validatedBaseSha = normalizeSha(snapshot?.validatedBaseSha);
  const pullRequestBaseSha = normalizeSha(pullRequest.baseSha);
  if (currentMainSha.length < 7 || validatedBaseSha.length < 7 || pullRequestBaseSha.length < 7) {
    reasons.push("base_evidence_missing");
  } else if (
    currentMainSha !== validatedBaseSha
    || pullRequestBaseSha !== validatedBaseSha
  ) {
    reasons.push("base_advanced_after_validation");
  }

  if (normalizeText(snapshot?.taskState) !== "REVIEW") {
    reasons.push("task_not_in_review_state");
  }

  const prCheckpoint = snapshot?.evidence?.prCheckpoint;
  if (
    prCheckpoint?.decision !== "REVIEW_CONFIRMED"
    || !exactHeadEvidence(prCheckpoint?.headSha, expectedHeadSha)
  ) {
    reasons.push("pr_checkpoint_missing_or_stale");
  }

  const acceptance = snapshot?.evidence?.acceptanceReview;
  if (
    acceptance?.completed !== true
    || acceptance?.satisfied !== true
    || !exactHeadEvidence(acceptance?.headSha, expectedHeadSha)
  ) {
    reasons.push("acceptance_not_satisfied_or_stale");
  }

  const focused = snapshot?.evidence?.focusedValidation;
  if (
    focused?.completed !== true
    || normalizeOutcome(focused?.status) !== "success"
    || !exactHeadEvidence(focused?.headSha, expectedHeadSha)
  ) {
    reasons.push("focused_validation_missing_red_or_stale");
  }

  const review = snapshot?.evidence?.review;
  if (
    review?.completed !== true
    || Number(review?.blockingFindings ?? -1) !== 0
    || Number(review?.unresolvedThreads ?? -1) !== 0
    || Number(review?.securityBlockingFindings ?? -1) !== 0
    || !exactHeadEvidence(review?.headSha, expectedHeadSha)
  ) {
    reasons.push("review_or_security_findings_unresolved_or_stale");
  }

  const documentation = snapshot?.evidence?.documentationImpact;
  if (
    !["updated", "not_required"].includes(documentation?.decision)
    || !exactHeadEvidence(documentation?.headSha, expectedHeadSha)
  ) {
    reasons.push("documentation_impact_unresolved_or_stale");
  }

  if (snapshot?.evidence?.dependencies?.resolved !== true) {
    reasons.push("dependencies_or_blockers_unresolved");
  }

  const rollback = snapshot?.evidence?.rollback;
  if (rollback?.required === true) {
    if (
      rollback?.completed !== true
      || !exactHeadEvidence(rollback?.headSha, expectedHeadSha)
    ) {
      reasons.push("rollback_recovery_evidence_missing_or_stale");
    }
  } else if (rollback?.required !== false) {
    reasons.push("rollback_requirement_not_decided");
  }

  const checks = [
    ["Required CI", snapshot?.checks?.requiredCi],
    ["scoped-e2e", snapshot?.checks?.scopedE2E],
    ["PR Collision Guard", snapshot?.checks?.collisionGuard],
  ];
  for (const [name, check] of checks) {
    const result = inspectRequiredCheck(name, check, expectedHeadSha);
    if (result.state === "WAIT") pending.push(result.reason);
    if (result.state === "BLOCKED") reasons.push(result.reason);
  }

  if (reasons.length > 0) {
    return {
      decision: "BLOCKED",
      reason: "merge_gate_evidence_not_satisfied",
      reasons: uniqueReasons(reasons),
      pending: uniqueReasons(pending),
      authorization: null,
      expectedHeadSha,
    };
  }

  if (pending.length > 0) {
    return {
      decision: "WAIT",
      reason: "required_checks_pending",
      reasons: [],
      pending: uniqueReasons(pending),
      authorization: null,
      expectedHeadSha,
    };
  }

  return {
    decision: "READY_FOR_MERGE",
    reason: "exact_head_repository_contract_satisfied",
    reasons: [],
    pending: [],
    expectedHeadSha,
    authorization: Object.freeze({
      contractVersion: AUTONOMOUS_MERGE_GATE_CONTRACT_VERSION,
      expectedHeadSha,
      expectedBaseSha: validatedBaseSha,
      forceAllowed: false,
      bypassAllowed: false,
      mergeOnlyThroughPullRequest: true,
    }),
  };
}
