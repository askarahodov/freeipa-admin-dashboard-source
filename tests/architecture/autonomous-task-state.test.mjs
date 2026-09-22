import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTONOMOUS_TASK_STATE_LABELS,
  classifyAutonomousTaskIssue,
  formatAutonomousTaskMarker,
  parseAutonomousTaskMetadata,
} from "../../scripts/autonomous-task-state.mjs";

const marker = (overrides = {}) =>
  formatAutonomousTaskMarker({
    priority: "P1",
    dependsOn: [],
    humanApprovalRequired: false,
    ...overrides,
  });

test("ordinary backlog issues remain unmanaged and are never selected implicitly", () => {
  assert.deepEqual(
    classifyAutonomousTaskIssue({
      state: "open",
      labels: ["bug", "P1"],
      body: "ordinary historical issue without autonomous metadata",
    }),
    {
      managed: false,
      valid: true,
      state: "UNMANAGED",
      selectable: false,
      metadata: null,
      errors: [],
    },
  );
});

test("READY requires one canonical state label and valid v1 metadata", () => {
  const result = classifyAutonomousTaskIssue({
    state: "open",
    labels: [{ name: AUTONOMOUS_TASK_STATE_LABELS.READY }],
    body: `## Goal\n\nSomething bounded.\n\n${marker({
      priority: "P0",
      dependsOn: [391, 681],
    })}`,
  });

  assert.equal(result.managed, true);
  assert.equal(result.valid, true);
  assert.equal(result.state, "READY");
  assert.equal(result.selectable, true);
  assert.deepEqual(result.metadata, {
    version: 1,
    priority: "P0",
    dependsOn: [391, 681],
    humanApprovalRequired: false,
  });
});

test("non-ready managed states are valid but not selectable", () => {
  for (const [state, label] of Object.entries(AUTONOMOUS_TASK_STATE_LABELS)) {
    if (state === "READY") continue;

    const result = classifyAutonomousTaskIssue({
      state: "open",
      labels: [label],
      body: marker(),
    });

    assert.equal(result.valid, true, state);
    assert.equal(result.state, state, state);
    assert.equal(result.selectable, false, state);
  }
});

test("a closed managed issue is DONE regardless of stale workflow label", () => {
  const result = classifyAutonomousTaskIssue({
    state: "closed",
    labels: [AUTONOMOUS_TASK_STATE_LABELS.REVIEW],
    body: marker(),
  });

  assert.equal(result.managed, true);
  assert.equal(result.valid, true);
  assert.equal(result.state, "DONE");
  assert.equal(result.selectable, false);
});

test("not-planned or duplicate closure is CANCELLED rather than falsely DONE", () => {
  for (const stateReason of ["not_planned", "duplicate"]) {
    const result = classifyAutonomousTaskIssue({
      state: "closed",
      state_reason: stateReason,
      labels: [AUTONOMOUS_TASK_STATE_LABELS.BLOCKED],
      body: marker(),
    });

    assert.equal(result.valid, true, stateReason);
    assert.equal(result.state, "CANCELLED", stateReason);
    assert.equal(result.selectable, false, stateReason);
  }
});

test("unknown closed-state reason fails closed", () => {
  const result = classifyAutonomousTaskIssue({
    state: "closed",
    state_reason: "mystery",
    labels: [AUTONOMOUS_TASK_STATE_LABELS.REVIEW],
    body: marker(),
  });

  assert.equal(result.valid, false);
  assert.equal(result.state, "INVALID");
  assert.deepEqual(result.errors, ["unknown_github_issue_state_reason"]);
});

test("open managed issue fails closed when state label is missing", () => {
  const result = classifyAutonomousTaskIssue({
    state: "open",
    labels: [],
    body: marker(),
  });

  assert.equal(result.managed, true);
  assert.equal(result.valid, false);
  assert.equal(result.state, "INVALID");
  assert.deepEqual(result.errors, ["open_managed_issue_requires_exactly_one_state_label"]);
});

test("state label without metadata cannot opt an issue into autonomous scheduling", () => {
  const result = classifyAutonomousTaskIssue({
    state: "open",
    labels: [AUTONOMOUS_TASK_STATE_LABELS.READY],
    body: "missing marker",
  });

  assert.equal(result.valid, false);
  assert.equal(result.state, "INVALID");
  assert.deepEqual(result.errors, ["managed_state_label_requires_metadata_marker"]);
});

test("multiple autonomous state labels fail closed", () => {
  const result = classifyAutonomousTaskIssue({
    state: "open",
    labels: [
      AUTONOMOUS_TASK_STATE_LABELS.READY,
      AUTONOMOUS_TASK_STATE_LABELS.BLOCKED,
    ],
    body: marker(),
  });

  assert.equal(result.valid, false);
  assert.equal(result.state, "INVALID");
  assert.deepEqual(result.errors, ["multiple_autonomous_task_state_labels"]);
});

test("metadata parser rejects unknown versions, duplicate markers and incomplete metadata", () => {
  assert.deepEqual(
    parseAutonomousTaskMetadata('<!-- ai-task:v2 {"priority":"P1"} -->'),
    {
      present: true,
      metadata: null,
      errors: ["malformed_or_unsupported_autonomous_task_marker"],
    },
  );

  const duplicate = `${marker()}\n${marker()}`;
  assert.deepEqual(parseAutonomousTaskMetadata(duplicate), {
    present: true,
    metadata: null,
    errors: ["multiple_autonomous_task_markers"],
  });

  const incomplete = parseAutonomousTaskMetadata(
    '<!-- ai-task:v1 {"priority":"P1","dependsOn":[]} -->',
  );
  assert.equal(incomplete.present, true);
  assert.equal(incomplete.metadata, null);
  assert.deepEqual(incomplete.errors, ["invalid_or_missing_human_approval_flag"]);
});

test("metadata validation rejects ambiguous dependencies and unknown keys", () => {
  const result = parseAutonomousTaskMetadata(
    '<!-- ai-task:v1 {"priority":"P1","dependsOn":[681,681,0],"humanApprovalRequired":false,"owner":"agent"} -->',
  );

  assert.equal(result.present, true);
  assert.equal(result.metadata, null);
  assert.deepEqual(result.errors, [
    "unknown_autonomous_task_metadata_key",
    "dependencies_must_be_unique_positive_issue_numbers",
  ]);
});

test("marker formatter is deterministic and validates caller input", () => {
  assert.equal(
    marker({ priority: "P2", dependsOn: [391], humanApprovalRequired: true }),
    '<!-- ai-task:v1 {"priority":"P2","dependsOn":[391],"humanApprovalRequired":true} -->',
  );

  assert.throws(
    () => formatAutonomousTaskMarker({ priority: "urgent", dependsOn: [], humanApprovalRequired: false }),
    /priority must be one of P0, P1, P2, P3/u,
  );
  assert.throws(
    () => formatAutonomousTaskMarker({ priority: "P1", dependsOn: [1, 1], humanApprovalRequired: false }),
    /unique positive integer issue numbers/u,
  );
});
