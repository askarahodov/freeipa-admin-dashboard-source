export const AUTONOMOUS_TASK_CONTRACT_VERSION = 1;

export const AUTONOMOUS_TASK_STATE_LABELS = Object.freeze({
  READY: "ai:ready",
  IN_PROGRESS: "ai:in-progress",
  REVIEW: "ai:review",
  BLOCKED: "ai:blocked",
});

export const AUTONOMOUS_TASK_STATES = Object.freeze([
  "READY",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);

const STATE_BY_LABEL = new Map(
  Object.entries(AUTONOMOUS_TASK_STATE_LABELS).map(([state, label]) => [label, state]),
);

const METADATA_PREFIX = "<!-- ai-task:v1 ";
const METADATA_SUFFIX = " -->";
const PRIORITY_PATTERN = /^P[0-3]$/u;

function normalizeLabelName(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.name ?? "").trim();
}

function normalizeIssueState(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeIssueStateReason(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uniquePositiveIntegers(values) {
  const output = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) continue;
    seen.add(number);
    output.push(number);
  }
  return output;
}

export function formatAutonomousTaskMarker({
  priority,
  dependsOn = [],
  humanApprovalRequired = false,
} = {}) {
  if (!PRIORITY_PATTERN.test(String(priority ?? ""))) {
    throw new TypeError("priority must be one of P0, P1, P2, P3");
  }

  const normalizedDependencies = uniquePositiveIntegers(dependsOn);
  if (normalizedDependencies.length !== (dependsOn ?? []).length) {
    throw new TypeError("dependsOn must contain unique positive integer issue numbers");
  }

  if (typeof humanApprovalRequired !== "boolean") {
    throw new TypeError("humanApprovalRequired must be boolean");
  }

  return `${METADATA_PREFIX}${JSON.stringify({
    priority,
    dependsOn: normalizedDependencies,
    humanApprovalRequired,
  })}${METADATA_SUFFIX}`;
}

export function parseAutonomousTaskMetadata(body) {
  const source = String(body ?? "");
  const markerStarts = source.match(/<!--\s*ai-task:/gu) ?? [];

  if (markerStarts.length === 0) {
    return { present: false, metadata: null, errors: [] };
  }

  const exactPattern = /<!--\s*ai-task:v1\s+(\{[^\n]*\})\s*-->/gu;
  const matches = Array.from(source.matchAll(exactPattern));

  if (matches.length !== 1 || markerStarts.length !== 1) {
    return {
      present: true,
      metadata: null,
      errors: [
        matches.length > 1 || markerStarts.length > 1
          ? "multiple_autonomous_task_markers"
          : "malformed_or_unsupported_autonomous_task_marker",
      ],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    return { present: true, metadata: null, errors: ["invalid_autonomous_task_json"] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { present: true, metadata: null, errors: ["autonomous_task_metadata_must_be_object"] };
  }

  const allowedKeys = new Set(["priority", "dependsOn", "humanApprovalRequired"]);
  const unknownKeys = Object.keys(parsed).filter((key) => !allowedKeys.has(key));
  const errors = [];

  if (unknownKeys.length > 0) errors.push("unknown_autonomous_task_metadata_key");

  if (!PRIORITY_PATTERN.test(String(parsed.priority ?? ""))) {
    errors.push("invalid_or_missing_priority");
  }

  if (!Array.isArray(parsed.dependsOn)) {
    errors.push("invalid_or_missing_dependencies");
  }

  const dependencies = Array.isArray(parsed.dependsOn)
    ? uniquePositiveIntegers(parsed.dependsOn)
    : [];
  if (
    Array.isArray(parsed.dependsOn)
    && dependencies.length !== parsed.dependsOn.length
  ) {
    errors.push("dependencies_must_be_unique_positive_issue_numbers");
  }

  if (typeof parsed.humanApprovalRequired !== "boolean") {
    errors.push("invalid_or_missing_human_approval_flag");
  }

  if (errors.length > 0) {
    return { present: true, metadata: null, errors };
  }

  return {
    present: true,
    metadata: Object.freeze({
      version: AUTONOMOUS_TASK_CONTRACT_VERSION,
      priority: parsed.priority,
      dependsOn: Object.freeze(dependencies),
      humanApprovalRequired: parsed.humanApprovalRequired,
    }),
    errors: [],
  };
}

export function classifyAutonomousTaskIssue(issue) {
  const labels = Array.from(issue?.labels ?? [], normalizeLabelName).filter(Boolean);
  const managedLabels = labels.filter((label) => STATE_BY_LABEL.has(label));
  const metadataResult = parseAutonomousTaskMetadata(issue?.body);

  if (!metadataResult.present && managedLabels.length === 0) {
    return {
      managed: false,
      valid: true,
      state: "UNMANAGED",
      selectable: false,
      metadata: null,
      errors: [],
    };
  }

  const errors = [...metadataResult.errors];

  if (!metadataResult.present) {
    errors.push("managed_state_label_requires_metadata_marker");
  }

  if (managedLabels.length > 1) {
    errors.push("multiple_autonomous_task_state_labels");
  }

  const githubState = normalizeIssueState(issue?.state);
  const stateReason = normalizeIssueStateReason(issue?.state_reason ?? issue?.stateReason);

  if (githubState !== "open" && githubState !== "closed") {
    errors.push("unknown_github_issue_state");
  }

  if (
    githubState === "closed"
    && stateReason
    && !["completed", "not_planned", "duplicate"].includes(stateReason)
  ) {
    errors.push("unknown_github_issue_state_reason");
  }

  if (errors.length > 0) {
    return {
      managed: true,
      valid: false,
      state: "INVALID",
      selectable: false,
      metadata: metadataResult.metadata,
      errors: Object.freeze(Array.from(new Set(errors)).sort()),
    };
  }

  if (githubState === "closed") {
    return {
      managed: true,
      valid: true,
      state: stateReason === "not_planned" || stateReason === "duplicate" ? "CANCELLED" : "DONE",
      selectable: false,
      metadata: metadataResult.metadata,
      errors: [],
    };
  }

  if (managedLabels.length !== 1) {
    return {
      managed: true,
      valid: false,
      state: "INVALID",
      selectable: false,
      metadata: metadataResult.metadata,
      errors: ["open_managed_issue_requires_exactly_one_state_label"],
    };
  }

  const state = STATE_BY_LABEL.get(managedLabels[0]);
  return {
    managed: true,
    valid: true,
    state,
    selectable: state === "READY",
    metadata: metadataResult.metadata,
    errors: [],
  };
}
