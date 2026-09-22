export const AUTONOMOUS_RUN_CONTROL_CONTRACT_VERSION = 1;

export const AUTONOMOUS_RUN_EVENT_TYPES = Object.freeze([
  "SELECT",
  "CLAIM",
  "TRANSITION",
  "VALIDATION",
  "CI_REPAIR",
  "MERGE_GATE",
  "POST_MERGE",
  "STOP",
]);

export const AUTONOMOUS_OPERATOR_ACTIONS = Object.freeze([
  "START_TASK",
  "TRANSITION",
  "REPAIR",
  "MERGE",
  "CLOSE_ISSUE",
  "CONTINUE",
]);

const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;
const SECRET_KEY_PATTERN = /(authorization|api[_-]?key|cookie|credential|password|private[_-]?key|secret|session|token)/iu;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function assertRunId(runId) {
  const normalized = normalizeText(runId);
  if (!RUN_ID_PATTERN.test(normalized)) {
    throw new TypeError("runId must be 8-128 safe identifier characters");
  }
  return normalized;
}

function boundedString(value) {
  const text = String(value ?? "");
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text))) return "[REDACTED]";
  return text.length > 500 ? `${text.slice(0, 500)}...[TRUNCATED]` : text;
}

export function sanitizeAutonomousAuditValue(value, key = "", depth = 0) {
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (SECRET_KEY_PATTERN.test(String(key))) return "[REDACTED]";

  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value ?? null;
  }
  if (typeof value === "string") return boundedString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeAutonomousAuditValue(entry, "", depth + 1));
  }
  if (typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      output[childKey] = sanitizeAutonomousAuditValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return boundedString(value);
}

function validOptionalSha(value) {
  const sha = normalizeSha(value);
  return sha ? (sha.length >= 7 ? sha : null) : null;
}

export function buildAutonomousAuditEvent({
  runId,
  sequence,
  eventType,
  issue,
  baseSha = null,
  headSha = null,
  transition = null,
  reason,
  checks = null,
  evidence = null,
  retryCount = 0,
  gateResult = null,
  nextAction = null,
}) {
  const id = assertRunId(runId);
  const seq = Number(sequence);
  const issueNumber = Number(issue);
  const retries = Number(retryCount);

  if (!Number.isInteger(seq) || seq <= 0) throw new TypeError("sequence must be a positive integer");
  if (!AUTONOMOUS_RUN_EVENT_TYPES.includes(eventType)) throw new TypeError("unsupported eventType");
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new TypeError("issue must be positive integer");
  if (!Number.isInteger(retries) || retries < 0) throw new TypeError("retryCount must be non-negative integer");
  if (!normalizeText(reason)) throw new TypeError("reason is required");

  const normalizedBase = validOptionalSha(baseSha);
  const normalizedHead = validOptionalSha(headSha);
  if (baseSha && !normalizedBase) throw new TypeError("baseSha is invalid");
  if (headSha && !normalizedHead) throw new TypeError("headSha is invalid");

  return Object.freeze({
    contractVersion: AUTONOMOUS_RUN_CONTROL_CONTRACT_VERSION,
    runId: id,
    sequence: seq,
    eventType,
    issue: issueNumber,
    baseSha: normalizedBase,
    headSha: normalizedHead,
    transition: sanitizeAutonomousAuditValue(transition),
    reason: boundedString(reason),
    checks: sanitizeAutonomousAuditValue(checks),
    evidence: sanitizeAutonomousAuditValue(evidence),
    retryCount: retries,
    gateResult: sanitizeAutonomousAuditValue(gateResult),
    nextAction: nextAction ? boundedString(nextAction) : null,
  });
}

export function formatAutonomousAuditMarker(event) {
  if (!event || event.contractVersion !== AUTONOMOUS_RUN_CONTROL_CONTRACT_VERSION) {
    throw new TypeError("valid autonomous audit event required");
  }
  const sanitized = sanitizeAutonomousAuditValue(event);
  const payload = JSON.stringify(sanitized).replace(/-->/gu, "--\\u003e");
  return `<!-- ai-run-event:v1 ${payload} -->`;
}

export function parseAutonomousAuditMarker(value) {
  const source = String(value ?? "");
  const match = source.match(/<!--\s*ai-run-event:v1\s+(\{[^\n]*\})\s*-->/u);
  if (!match) return { valid: false, event: null, reason: "marker_missing_or_malformed" };
  try {
    const event = JSON.parse(match[1]);
    if (event?.contractVersion !== AUTONOMOUS_RUN_CONTROL_CONTRACT_VERSION) {
      return { valid: false, event: null, reason: "marker_contract_invalid" };
    }

    const normalized = buildAutonomousAuditEvent({
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      issue: event.issue,
      baseSha: event.baseSha,
      headSha: event.headSha,
      transition: event.transition,
      reason: event.reason,
      checks: event.checks,
      evidence: event.evidence,
      retryCount: event.retryCount,
      gateResult: event.gateResult,
      nextAction: event.nextAction,
    });
    return { valid: true, event: normalized, reason: "marker_valid" };
  } catch {
    return { valid: false, event: null, reason: "marker_contract_invalid" };
  }
}

function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function evaluateAutonomousOperatorControl({
  control,
  counters,
  proposedAction,
}) {
  const action = normalizeText(proposedAction);
  const enabled = control?.enabled === true;
  const paused = control?.paused === true;
  const dryRun = control?.dryRun === true;

  if (!AUTONOMOUS_OPERATOR_ACTIONS.includes(action)) {
    return {
      decision: "STOP",
      reason: "unsupported_operator_action",
      mutationAllowed: false,
      nextAction: "USE_CANONICAL_OPERATOR_ACTION",
    };
  }

  if (!enabled) {
    return {
      decision: "STOP",
      reason: "autonomous_execution_disabled",
      mutationAllowed: false,
      nextAction: "ENABLE_AUTONOMOUS_EXECUTION",
    };
  }
  if (paused) {
    return {
      decision: "STOP",
      reason: "autonomous_execution_paused",
      mutationAllowed: false,
      nextAction: "OPERATOR_RESUME_REQUIRED",
    };
  }

  const maxTasks = normalizeLimit(control?.maxTasksPerRun, 5);
  const maxRepairs = normalizeLimit(control?.maxRepairsPerRun, 3);
  const maxIterations = normalizeLimit(control?.maxIterationsPerRun, 5);
  if (!maxTasks || !maxRepairs || !maxIterations) {
    return {
      decision: "STOP",
      reason: "invalid_operator_limits",
      mutationAllowed: false,
      nextAction: "FIX_OPERATOR_LIMITS",
    };
  }

  const tasks = Number(counters?.tasks ?? 0);
  const repairs = Number(counters?.repairs ?? 0);
  const iterations = Number(counters?.iterations ?? 0);
  if (![tasks, repairs, iterations].every((value) => Number.isInteger(value) && value >= 0)) {
    return {
      decision: "STOP",
      reason: "invalid_run_counters",
      mutationAllowed: false,
      nextAction: "RECONCILE_RUN_COUNTERS",
    };
  }

  if (action === "START_TASK" && tasks >= maxTasks) {
    return {
      decision: "STOP",
      reason: "task_limit_reached",
      mutationAllowed: false,
      nextAction: "START_NEW_BOUNDED_RUN",
    };
  }
  if (action === "REPAIR" && repairs >= maxRepairs) {
    return {
      decision: "STOP",
      reason: "repair_limit_reached",
      mutationAllowed: false,
      nextAction: "OPERATOR_REVIEW_REQUIRED",
    };
  }
  if (action === "CONTINUE" && iterations >= maxIterations) {
    return {
      decision: "STOP",
      reason: "iteration_limit_reached",
      mutationAllowed: false,
      nextAction: "START_NEW_BOUNDED_RUN",
    };
  }

  if (dryRun) {
    return {
      decision: "DRY_RUN",
      reason: "dry_run_never_mutates_github_state",
      mutationAllowed: false,
      proposedAction: action,
      nextAction: "REPORT_WOULD_EXECUTE",
    };
  }

  return {
    decision: "ALLOW",
    reason: "operator_controls_allow_action",
    mutationAllowed: true,
    proposedAction: action,
    limits: Object.freeze({ maxTasks, maxRepairs, maxIterations }),
  };
}

function validatedHistory(history, runId) {
  const id = assertRunId(runId);
  const events = Array.isArray(history) ? history : [];
  let previous = 0;
  for (const event of events) {
    if (event?.runId !== id) return { ok: false, reason: "audit_run_id_mismatch" };
    const sequence = Number(event?.sequence);
    if (!Number.isInteger(sequence) || sequence <= previous) {
      return { ok: false, reason: "audit_sequence_not_monotonic" };
    }
    previous = sequence;
  }
  return { ok: true, events, last: events.at(-1) ?? null };
}

function auditHistoryForIssue(events, issue) {
  const issueNumber = Number(issue);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) return [];
  return events.filter((event) => Number(event?.issue) === issueNumber);
}

export function planAutonomousRunRecovery({
  runId,
  auditHistory = [],
  executionDecision,
}) {
  const history = validatedHistory(auditHistory, runId);
  if (!history.ok) {
    return {
      decision: "STOP",
      reason: history.reason,
      nextAction: "RECONCILE_AUDIT_HISTORY",
      mutationAllowed: false,
    };
  }

  if (!executionDecision || typeof executionDecision !== "object") {
    return {
      decision: "STOP",
      reason: "canonical_execution_decision_missing",
      nextAction: "REFRESH_EXECUTION_STATE",
      mutationAllowed: false,
    };
  }

  if (executionDecision.decision === "BLOCKED") {
    return {
      decision: "STOP",
      reason: executionDecision.reason || "canonical_execution_blocked",
      nextAction: "RESOLVE_BLOCKER_AND_REFRESH",
      mutationAllowed: false,
      executionDecision,
    };
  }

  if ([
    "RECOVER_CLAIM",
    "RESUME_IMPLEMENTATION",
    "RESUME_PR_CHECKPOINT",
    "RESUME_REVIEW",
  ].includes(executionDecision.decision)) {
    const claimHistory = auditHistoryForIssue(history.events, executionDecision.claim?.issue);
    return {
      decision: "RESUME",
      reason: "canonical_execution_contract_recovered_existing_ownership",
      nextAction: executionDecision.decision,
      mutationAllowed: true,
      claim: executionDecision.claim ?? null,
      previousAuditEvent: claimHistory.at(-1) ?? history.last,
    };
  }

  if (executionDecision.decision === "CLAIM_NEW") {
    const claimIssue = Number(executionDecision.claim?.issue);
    if (!Number.isInteger(claimIssue) || claimIssue <= 0) {
      return {
        decision: "STOP",
        reason: "new_claim_issue_missing_or_invalid",
        nextAction: "REFRESH_EXECUTION_STATE",
        mutationAllowed: false,
      };
    }

    const claimHistory = auditHistoryForIssue(history.events, claimIssue);
    if (claimHistory.length > 0) {
      return {
        decision: "STOP",
        reason: "audited_claim_exists_but_execution_requests_new_claim",
        nextAction: "REFRESH_BRANCH_ISSUE_AND_CLAIM_EVIDENCE",
        mutationAllowed: false,
        previousAuditEvent: claimHistory.at(-1),
      };
    }
    return {
      decision: "START",
      reason: history.last
        ? "bounded_run_can_claim_next_issue"
        : "fresh_run_can_claim_new_issue",
      nextAction: "CLAIM_NEW",
      mutationAllowed: true,
      claim: executionDecision.claim,
      previousAuditEvent: history.last,
    };
  }

  return {
    decision: "STOP",
    reason: "unsupported_execution_recovery_decision",
    nextAction: "REFRESH_EXECUTION_STATE",
    mutationAllowed: false,
  };
}
