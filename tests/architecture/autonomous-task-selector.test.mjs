import assert from "node:assert/strict";
import test from "node:test";

import { formatAutonomousTaskMarker } from "../../scripts/autonomous-task-state.mjs";
import { selectNextAutonomousTask } from "../../scripts/autonomous-task-selector.mjs";

const managed = (number, {
  state = "open",
  stateReason,
  label = "ai:ready",
  priority = "P1",
  dependsOn = [],
  humanApprovalRequired = false,
} = {}) => ({
  number,
  state,
  state_reason: stateReason,
  labels: [label],
  body: formatAutonomousTaskMarker({ priority, dependsOn, humanApprovalRequired }),
});

const snapshot = (issues, collisionEvidence = {}, overrides = {}) => ({
  githubAvailable: true,
  mainSha: "0123456789abcdef",
  issues,
  openPullRequests: [],
  collisionEvidence,
  ...overrides,
});

test("selects the only executable READY issue", () => {
  const result = selectNextAutonomousTask(snapshot(
    [managed(10)],
    { "10": "clean" },
  ));
  assert.equal(result.decision, "SELECTED");
  assert.deepEqual(result.selected, { issue: 10, priority: "P1" });
});

test("priority wins before issue number among executable work", () => {
  const result = selectNextAutonomousTask(snapshot(
    [managed(10, { priority: "P2" }), managed(20, { priority: "P0" })],
    { "10": "clean", "20": "clean" },
  ));
  assert.equal(result.selected.issue, 20);
});

test("blocked dependency prevents selection", () => {
  const result = selectNextAutonomousTask(snapshot(
    [managed(10, { dependsOn: [9] }), managed(9, { label: "ai:blocked" })],
    { "10": "clean", "9": "clean" },
  ));
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rejected.find((entry) => entry.issue === 10).reason, "dependency_not_done");
});

test("completed dependency unlocks the candidate", () => {
  const done = managed(9, { state: "closed", stateReason: "completed", label: "ai:review" });
  const result = selectNextAutonomousTask(snapshot(
    [managed(10, { dependsOn: [9] }), done],
    { "10": "clean", "9": "clean" },
  ));
  assert.equal(result.decision, "SELECTED");
  assert.equal(result.selected.issue, 10);
});

test("active ownership collision fails closed", () => {
  const result = selectNextAutonomousTask(snapshot(
    [managed(10)],
    { "10": "collision" },
  ));
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rejected[0].reason, "active_ownership_collision");
});

test("missing collision evidence fails closed", () => {
  const result = selectNextAutonomousTask(snapshot([managed(10)], {}));
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rejected[0].reason, "collision_evidence_not_clean");
});

test("human approval boundary is not crossed", () => {
  const result = selectNextAutonomousTask(snapshot(
    [managed(10, { humanApprovalRequired: true })],
    { "10": "clean" },
  ));
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rejected[0].reason, "human_approval_required");
});

test("ambiguous task metadata is rejected rather than guessed", () => {
  const bad = managed(10);
  bad.body = '<!-- ai-task:v1 {"priority":"P1"} -->';
  const result = selectNextAutonomousTask(snapshot([bad], { "10": "clean" }));
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rejected[0].reason, "invalid_task_state");
});

test("no managed READY work returns NO_WORK", () => {
  const result = selectNextAutonomousTask(snapshot([
    { number: 10, state: "open", labels: ["bug"], body: "ordinary issue" },
  ], {}));
  assert.equal(result.decision, "NO_WORK");
});

test("GitHub/API failure blocks selection", () => {
  const result = selectNextAutonomousTask(snapshot([], {}, { githubAvailable: false }));
  assert.deepEqual(result, {
    decision: "BLOCKED",
    reason: "github_state_unavailable",
    selected: null,
    rejected: [],
  });
});

test("same snapshot produces the same decision", () => {
  const input = snapshot(
    [managed(30, { priority: "P1" }), managed(20, { priority: "P1" })],
    { "20": "clean", "30": "clean" },
  );
  assert.deepEqual(selectNextAutonomousTask(input), selectNextAutonomousTask(structuredClone(input)));
  assert.equal(selectNextAutonomousTask(input).selected.issue, 20);
});
