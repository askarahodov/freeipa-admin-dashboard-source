import { createHash } from "node:crypto";

export const AUTONOMOUS_CI_REPAIR_CONTRACT_VERSION = 1;
export const MAX_TRANSIENT_RETRIES = 1;
export const MAX_CODE_REPAIR_ATTEMPTS = 3;

export const CI_FAILURE_CLASSES = Object.freeze([
  "REGRESSION",
  "EXPOSED_DEFECT",
  "INVALID_TEST",
  "FLAKY",
  "INFRASTRUCTURE",
]);

export const INFRASTRUCTURE_SIGNAL_CODES = Object.freeze([
  "runner_unavailable",
  "github_service_error",
  "artifact_service_error",
  "registry_network_error",
  "external_network_error",
  "rate_limit",
  "cancelled_by_platform",
]);

export const TRANSIENT_SIGNAL_CODES = Object.freeze([
  "timeout_without_assertion",
  "connection_reset",
  "worker_restart",
  "known_flake_fingerprint",
]);

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizedOutcome(value) {
  return String(value ?? "").trim().toLowerCase();
}

function includesCode(list, value) {
  return list.includes(String(value ?? "").trim());
}

function exactHeadEvidence(snapshot) {
  const expected = normalizeSha(snapshot?.expectedHeadSha);
  const observed = normalizeSha(snapshot?.workflowRun?.headSha);
  return expected.length >= 7 && observed === expected;
}

export function buildCiFailureFingerprint({
  workflowName,
  jobName,
  stepName,
  logSignature,
}) {
  const signature = normalizeText(logSignature);
  if (!signature) throw new TypeError("sanitized logSignature is required");
  const payload = [
    normalizeText(workflowName),
    normalizeText(jobName),
    normalizeText(stepName),
    signature.slice(0, 2000),
  ].join("\n");

  return createHash("sha256").update(payload).digest("hex");
}

function baseClassificationResult(snapshot, fingerprint) {
  return {
    contractVersion: AUTONOMOUS_CI_REPAIR_CONTRACT_VERSION,
    headSha: normalizeSha(snapshot.expectedHeadSha),
    workflowRunId: Number(snapshot.workflowRun?.id) || null,
    jobId: Number(snapshot.job?.id) || null,
    fingerprint,
  };
}

export function classifyAutonomousCiFailure(snapshot) {
  if (!snapshot || !exactHeadEvidence(snapshot)) {
    return {
      classification: "UNKNOWN",
      reason: "workflow_head_not_exact",
      ...baseClassificationResult(snapshot ?? {}, null),
    };
  }

  if (
    Number(snapshot.job?.runId) !== Number(snapshot.workflowRun?.id)
    || !Number.isInteger(Number(snapshot.job?.id))
  ) {
    return {
      classification: "UNKNOWN",
      reason: "job_run_evidence_mismatch",
      ...baseClassificationResult(snapshot, null),
    };
  }

  const workflowConclusion = normalizedOutcome(snapshot.workflowRun?.conclusion);
  const jobConclusion = normalizedOutcome(snapshot.job?.conclusion);
  const terminalFailure = ["failure", "cancelled", "timed_out", "action_required"].includes(workflowConclusion)
    || ["failure", "cancelled", "timed_out", "action_required"].includes(jobConclusion);

  if (!terminalFailure) {
    return {
      classification: "NONE",
      reason: "no_terminal_failure",
      ...baseClassificationResult(snapshot, null),
    };
  }

  const logSignature = normalizeText(snapshot.evidence?.logSignature);
  if (!logSignature) {
    return {
      classification: "UNKNOWN",
      reason: "sanitized_log_signature_missing",
      ...baseClassificationResult(snapshot, null),
    };
  }

  const fingerprint = buildCiFailureFingerprint({
    workflowName: snapshot.workflowRun?.name,
    jobName: snapshot.job?.name,
    stepName: snapshot.failedStep?.name,
    logSignature,
  });

  const evidence = snapshot.evidence ?? {};
  const candidates = [];

  const infrastructure = (
    includesCode(INFRASTRUCTURE_SIGNAL_CODES, evidence.infrastructureSignal)
    && evidence.productAssertionObserved !== true
  );
  if (infrastructure) candidates.push("INFRASTRUCTURE");

  const outcomes = new Set(
    Array.isArray(evidence.sameHeadOutcomes)
      ? evidence.sameHeadOutcomes.map(normalizedOutcome)
      : [],
  );
  const flaky = (
    (outcomes.has("failure") && outcomes.has("success"))
    || (
      includesCode(TRANSIENT_SIGNAL_CODES, evidence.transientSignal)
      && evidence.focusedReproduction !== "fails"
      && evidence.productAssertionObserved !== true
    )
  );
  if (flaky) candidates.push("FLAKY");

  const exposedDefect = (
    evidence.focusedReproduction === "fails"
    && evidence.baseReproduction === "fails_same"
  );
  if (exposedDefect) candidates.push("EXPOSED_DEFECT");

  const invalidTest = (
    evidence.testExpectationContradictsContract === true
    && normalizeText(evidence.canonicalContractReference).length > 0
  );
  if (invalidTest) candidates.push("INVALID_TEST");

  const regression = (
    evidence.focusedReproduction === "fails"
    && evidence.baseReproduction === "passes"
    && evidence.validTestAssertion === true
    && evidence.testExpectationContradictsContract !== true
  );
  if (regression) candidates.push("REGRESSION");

  const unique = Array.from(new Set(candidates));
  if (unique.length === 0) {
    return {
      classification: "UNKNOWN",
      reason: "insufficient_classification_evidence",
      ...baseClassificationResult(snapshot, fingerprint),
    };
  }
  if (unique.length > 1) {
    return {
      classification: "AMBIGUOUS",
      reason: "conflicting_classification_evidence",
      candidates: unique.sort(),
      ...baseClassificationResult(snapshot, fingerprint),
    };
  }

  return {
    classification: unique[0],
    reason: "classified_from_exact_head_evidence",
    ...baseClassificationResult(snapshot, fingerprint),
  };
}

function sameFailureHistory(history, classification) {
  return (history ?? []).filter((entry) => (
    normalizeSha(entry?.headSha) === classification.headSha
    && String(entry?.fingerprint ?? "") === String(classification.fingerprint ?? "")
  ));
}

function auditEntry(classification, action, attemptNumber, reason) {
  return Object.freeze({
    contractVersion: AUTONOMOUS_CI_REPAIR_CONTRACT_VERSION,
    headSha: classification.headSha,
    workflowRunId: classification.workflowRunId,
    jobId: classification.jobId,
    fingerprint: classification.fingerprint,
    classification: classification.classification,
    action,
    attemptNumber,
    reason,
  });
}

export function planAutonomousCiRepair(classification, history = []) {
  if (!classification || !classification.headSha) {
    return {
      decision: "BLOCKED",
      reason: "invalid_failure_classification",
      action: null,
      audit: null,
    };
  }

  const matching = sameFailureHistory(history, classification);
  const priorTransientRetries = matching.filter((entry) => entry?.action === "RETRY_EXACT_HEAD").length;
  const priorCodeRepairs = (history ?? []).filter((entry) => (
    entry?.action === "RETURN_TO_IMPLEMENTATION"
    && String(entry?.classification ?? "") === String(classification.classification)
    && String(entry?.fingerprint ?? "") === String(classification.fingerprint ?? "")
  )).length;

  if (["UNKNOWN", "AMBIGUOUS", "NONE"].includes(classification.classification)) {
    const reason = classification.classification === "NONE"
      ? "no_failure_to_repair"
      : "failure_not_safely_classified";
    return {
      decision: classification.classification === "NONE" ? "NO_ACTION" : "BLOCKED",
      reason,
      action: null,
      audit: auditEntry(classification, "NONE", matching.length + 1, reason),
    };
  }

  if (["INFRASTRUCTURE", "FLAKY"].includes(classification.classification)) {
    if (priorTransientRetries >= MAX_TRANSIENT_RETRIES) {
      return {
        decision: "BLOCKED",
        reason: "transient_retry_limit_exhausted",
        action: null,
        audit: auditEntry(
          classification,
          "NONE",
          priorTransientRetries + 1,
          "transient_retry_limit_exhausted",
        ),
      };
    }

    return {
      decision: "RETRY",
      reason: "bounded_exact_head_retry_permitted",
      action: Object.freeze({
        type: "RETRY_EXACT_HEAD",
        retryScope: "failed_jobs",
        expectedHeadSha: classification.headSha,
        codeChangesAllowed: false,
      }),
      audit: auditEntry(
        classification,
        "RETRY_EXACT_HEAD",
        priorTransientRetries + 1,
        "bounded_exact_head_retry_permitted",
      ),
    };
  }

  if (classification.classification === "EXPOSED_DEFECT") {
    return {
      decision: "BLOCKED",
      reason: "pre_existing_defect_requires_coordinator_scope_decision",
      action: null,
      audit: auditEntry(
        classification,
        "NONE",
        matching.length + 1,
        "pre_existing_defect_requires_coordinator_scope_decision",
      ),
    };
  }

  if (["REGRESSION", "INVALID_TEST"].includes(classification.classification)) {
    if (priorCodeRepairs >= MAX_CODE_REPAIR_ATTEMPTS) {
      return {
        decision: "BLOCKED",
        reason: "code_repair_attempt_limit_exhausted",
        action: null,
        audit: auditEntry(
          classification,
          "NONE",
          priorCodeRepairs + 1,
          "code_repair_attempt_limit_exhausted",
        ),
      };
    }

    const invalidTest = classification.classification === "INVALID_TEST";
    return {
      decision: "REPAIR",
      reason: invalidTest
        ? "canonical_contract_requires_test_correction"
        : "product_regression_requires_implementation_fix",
      action: Object.freeze({
        type: "RETURN_TO_IMPLEMENTATION",
        expectedHeadSha: classification.headSha,
        testChangesAllowed: invalidTest,
        validAssertionsMustNotBeWeakened: true,
        canonicalContractReviewRequired: invalidTest,
        focusedValidationRequiredBeforePush: true,
      }),
      audit: auditEntry(
        classification,
        "RETURN_TO_IMPLEMENTATION",
        priorCodeRepairs + 1,
        invalidTest
          ? "canonical_contract_requires_test_correction"
          : "product_regression_requires_implementation_fix",
      ),
    };
  }

  return {
    decision: "BLOCKED",
    reason: "unsupported_failure_class",
    action: null,
    audit: auditEntry(classification, "NONE", matching.length + 1, "unsupported_failure_class"),
  };
}

function exactValidation(rows, candidateHeadSha) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.every((row) => (
    typeof row?.command === "string"
    && row.command.trim().length > 0
    && row?.status === "success"
    && normalizeSha(row?.headSha) === normalizeSha(candidateHeadSha)
  ));
}

export function evaluateAutonomousRepairCandidate({
  previousHeadSha,
  candidateHeadSha,
  failureFingerprint,
  focusedValidation,
  finalDiffReview,
  repairSummary,
}) {
  const previous = normalizeSha(previousHeadSha);
  const candidate = normalizeSha(candidateHeadSha);
  const reasons = [];

  if (previous.length < 7 || candidate.length < 7 || previous === candidate) {
    reasons.push("candidate_head_not_new");
  }
  if (!normalizeText(failureFingerprint)) reasons.push("failure_fingerprint_missing");
  if (!exactValidation(focusedValidation, candidate)) {
    reasons.push("focused_validation_missing_red_or_stale");
  }
  if (
    finalDiffReview?.completed !== true
    || Number(finalDiffReview?.blockingFindings ?? 0) !== 0
    || normalizeSha(finalDiffReview?.headSha) !== candidate
  ) {
    reasons.push("final_diff_review_incomplete_blocked_or_stale");
  }
  if (!normalizeText(repairSummary)) reasons.push("repair_summary_missing");

  if (reasons.length > 0) {
    return {
      decision: "BLOCKED",
      reason: "repair_candidate_evidence_incomplete",
      reasons: Object.freeze(Array.from(new Set(reasons)).sort()),
    };
  }

  return {
    decision: "READY_FOR_CI",
    reason: "repair_candidate_validated_on_exact_new_head",
    expectedHeadSha: candidate,
    previousHeadSha: previous,
    nextAction: "PUSH_AND_WAIT_EXACT_HEAD_CI",
  };
}

function normalizedCheck(check) {
  return {
    headSha: normalizeSha(check?.headSha),
    status: normalizedOutcome(check?.status),
    conclusion: normalizedOutcome(check?.conclusion),
  };
}

export function evaluateAutonomousRepairLoopExit({
  expectedHeadSha,
  requiredCi,
  scopedE2E,
}) {
  const expected = normalizeSha(expectedHeadSha);
  if (expected.length < 7) {
    return { decision: "BLOCKED", reason: "invalid_expected_head" };
  }

  const ci = normalizedCheck(requiredCi);
  const e2e = normalizedCheck(scopedE2E);
  if (ci.headSha !== expected || e2e.headSha !== expected) {
    return { decision: "BLOCKED", reason: "post_repair_check_head_mismatch" };
  }

  const terminal = [ci, e2e].every((check) => check.status === "completed");
  if (!terminal) {
    return { decision: "WAIT", reason: "post_repair_checks_pending" };
  }

  if (ci.conclusion === "success" && e2e.conclusion === "success") {
    return {
      decision: "READY_FOR_MERGE_EVALUATION",
      reason: "post_repair_exact_head_checks_green",
      headSha: expected,
    };
  }

  return {
    decision: "REPAIR_REQUIRED",
    reason: "post_repair_exact_head_checks_not_green",
    headSha: expected,
  };
}
