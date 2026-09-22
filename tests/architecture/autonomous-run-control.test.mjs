import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutonomousAuditEvent,
  evaluateAutonomousOperatorControl,
  formatAutonomousAuditMarker,
  parseAutonomousAuditMarker,
  planAutonomousRunRecovery,
  sanitizeAutonomousAuditValue,
} from "../../scripts/autonomous-run-control.mjs";

const RUN = "ad-v1-687-run1";
const BASE = "aaaaaaaaaaaaaaaa";
const HEAD = "bbbbbbbbbbbbbbbb";

test("audit event records transition evidence while redacting nested secrets", () => {
  const event = buildAutonomousAuditEvent({
    runId: RUN,
    sequence: 1,
    eventType: "CLAIM",
    issue: 687,
    baseSha: BASE,
    headSha: HEAD,
    transition: { from: "READY", to: "IN_PROGRESS" },
    reason: "deterministic claim branch created",
    checks: { collision: "clean" },
    evidence: {
      branch: "agent/task-687",
      token: "super-secret-token",
      nested: {
        Authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
        safe: "visible",
      },
    },
    retryCount: 0,
    gateResult: { decision: "SELECTED" },
    nextAction: "IMPLEMENT",
  });

  assert.equal(event.evidence.token, "[REDACTED]");
  assert.equal(event.evidence.nested.Authorization, "[REDACTED]");
  assert.equal(event.evidence.nested.safe, "visible");
  assert.equal(event.transition.to, "IN_PROGRESS");
  assert.equal(event.baseSha, BASE);
  assert.equal(event.headSha, HEAD);
});

test("audit marker never emits bearer/token material and round-trips", () => {
  const event = buildAutonomousAuditEvent({
    runId: RUN,
    sequence: 2,
    eventType: "VALIDATION",
    issue: 687,
    reason: "focused checks",
    evidence: {
      password: "do-not-log",
      output: "Bearer abcdefghijklmnop",
      safe: "node --test tests/foo.test.mjs",
    },
  });
  const marker = formatAutonomousAuditMarker(event);
  assert.doesNotMatch(marker, /do-not-log/u);
  assert.doesNotMatch(marker, /Bearer abcdef/u);
  const parsed = parseAutonomousAuditMarker(marker);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.event.runId, RUN);
  assert.equal(parsed.event.sequence, 2);

  const externallyConstructed = {
    ...event,
    evidence: { token: "raw-token-that-must-not-leak" },
  };
  const externalMarker = formatAutonomousAuditMarker(externallyConstructed);
  assert.doesNotMatch(externalMarker, /raw-token-that-must-not-leak/u);
  assert.match(externalMarker, /\[REDACTED\]/u);
});

test("audit marker escapes HTML comment terminators and still round-trips", () => {
  const event = buildAutonomousAuditEvent({
    runId: RUN,
    sequence: 3,
    eventType: "VALIDATION",
    issue: 687,
    reason: "external --> **spoofed markdown**",
  });

  const marker = formatAutonomousAuditMarker(event);
  assert.equal((marker.match(/-->/gu) ?? []).length, 1);
  assert.doesNotMatch(marker, /--> \*\*spoofed markdown\*\*/u);

  const parsed = parseAutonomousAuditMarker(marker);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.event.reason, "external --> **spoofed markdown**");
});

test("audit marker parser rejects unsupported event types and invalid issue identity", () => {
  const unsupported = '<!-- ai-run-event:v1 {"contractVersion":1,"runId":"ad-v1-687-run1","sequence":1,"eventType":"FORGED","issue":687,"reason":"x","retryCount":0} -->';
  assert.equal(parseAutonomousAuditMarker(unsupported).valid, false);

  const missingIssue = '<!-- ai-run-event:v1 {"contractVersion":1,"runId":"ad-v1-687-run1","sequence":1,"eventType":"CLAIM","reason":"x","retryCount":0} -->';
  assert.equal(parseAutonomousAuditMarker(missingIssue).valid, false);
});

test("generic sanitizer redacts secret keys and token-like values", () => {
  const result = sanitizeAutonomousAuditValue({
    apiKey: "abc",
    note: "Bearer qwertyuiopasdfghjkl",
    normal: "ok",
  });
  assert.equal(result.apiKey, "[REDACTED]");
  assert.equal(result.note, "[REDACTED]");
  assert.equal(result.normal, "ok");
});

test("unknown operator action fails closed", () => {
  const result = evaluateAutonomousOperatorControl({
    control: { enabled: true, paused: false, dryRun: false },
    counters: {},
    proposedAction: "DO_ANYTHING",
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "unsupported_operator_action");
  assert.equal(result.mutationAllowed, false);
});

test("dry-run can plan but never mutate GitHub state", () => {
  const result = evaluateAutonomousOperatorControl({
    control: {
      enabled: true,
      paused: false,
      dryRun: true,
      maxTasksPerRun: 5,
      maxRepairsPerRun: 3,
      maxIterationsPerRun: 5,
    },
    counters: { tasks: 0, repairs: 0, iterations: 0 },
    proposedAction: "START_TASK",
  });
  assert.equal(result.decision, "DRY_RUN");
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.nextAction, "REPORT_WOULD_EXECUTE");
});

test("pause and disable stop future transitions safely", () => {
  const disabled = evaluateAutonomousOperatorControl({
    control: { enabled: false, paused: false, dryRun: false },
    counters: {},
    proposedAction: "START_TASK",
  });
  assert.equal(disabled.decision, "STOP");
  assert.equal(disabled.reason, "autonomous_execution_disabled");

  const paused = evaluateAutonomousOperatorControl({
    control: { enabled: true, paused: true, dryRun: false },
    counters: {},
    proposedAction: "CONTINUE",
  });
  assert.equal(paused.decision, "STOP");
  assert.equal(paused.reason, "autonomous_execution_paused");
  assert.equal(paused.mutationAllowed, false);
});

test("bounded task repair and iteration limits stop the run", () => {
  const control = {
    enabled: true,
    paused: false,
    dryRun: false,
    maxTasksPerRun: 2,
    maxRepairsPerRun: 1,
    maxIterationsPerRun: 2,
  };

  assert.equal(evaluateAutonomousOperatorControl({
    control,
    counters: { tasks: 2, repairs: 0, iterations: 0 },
    proposedAction: "START_TASK",
  }).reason, "task_limit_reached");

  assert.equal(evaluateAutonomousOperatorControl({
    control,
    counters: { tasks: 0, repairs: 1, iterations: 0 },
    proposedAction: "REPAIR",
  }).reason, "repair_limit_reached");

  assert.equal(evaluateAutonomousOperatorControl({
    control,
    counters: { tasks: 0, repairs: 0, iterations: 2 },
    proposedAction: "CONTINUE",
  }).reason, "iteration_limit_reached");
});

test("normal enabled run allows action within all bounds", () => {
  const result = evaluateAutonomousOperatorControl({
    control: {
      enabled: true,
      paused: false,
      dryRun: false,
      maxTasksPerRun: 5,
      maxRepairsPerRun: 3,
      maxIterationsPerRun: 5,
    },
    counters: { tasks: 1, repairs: 0, iterations: 1 },
    proposedAction: "CONTINUE",
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.mutationAllowed, true);
});

test("recovery resumes canonical existing claim instead of creating duplicate ownership", () => {
  const history = [
    buildAutonomousAuditEvent({
      runId: RUN,
      sequence: 1,
      eventType: "CLAIM",
      issue: 687,
      baseSha: BASE,
      reason: "claim recorded",
    }),
  ];
  const result = planAutonomousRunRecovery({
    runId: RUN,
    auditHistory: history,
    executionDecision: {
      decision: "RESUME_IMPLEMENTATION",
      claim: {
        issue: 687,
        branch: "agent/task-687",
        claimBaseSha: BASE,
      },
    },
  });
  assert.equal(result.decision, "RESUME");
  assert.equal(result.nextAction, "RESUME_IMPLEMENTATION");
  assert.equal(result.claim.branch, "agent/task-687");
});

test("existing audit for the same issue plus CLAIM_NEW stops duplicate ownership", () => {
  const history = [
    buildAutonomousAuditEvent({
      runId: RUN,
      sequence: 1,
      eventType: "CLAIM",
      issue: 687,
      reason: "existing run",
    }),
  ];
  const result = planAutonomousRunRecovery({
    runId: RUN,
    auditHistory: history,
    executionDecision: {
      decision: "CLAIM_NEW",
      claim: { issue: 687, branch: "agent/task-687" },
    },
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "audited_claim_exists_but_execution_requests_new_claim");
  assert.equal(result.mutationAllowed, false);
});

test("audit from a completed earlier task does not block the next claim in the same bounded run", () => {
  const history = [
    buildAutonomousAuditEvent({
      runId: RUN,
      sequence: 1,
      eventType: "POST_MERGE",
      issue: 686,
      reason: "previous task completed",
      nextAction: "CONTINUE",
    }),
  ];
  const result = planAutonomousRunRecovery({
    runId: RUN,
    auditHistory: history,
    executionDecision: {
      decision: "CLAIM_NEW",
      claim: { issue: 687, branch: "agent/task-687" },
    },
  });
  assert.equal(result.decision, "START");
  assert.equal(result.reason, "bounded_run_can_claim_next_issue");
  assert.equal(result.mutationAllowed, true);
  assert.equal(result.claim.issue, 687);
});

test("canonical execution blocker is surfaced with exact operator next action", () => {
  const result = planAutonomousRunRecovery({
    runId: RUN,
    auditHistory: [],
    executionDecision: {
      decision: "BLOCKED",
      reason: "active_ownership_collision",
    },
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "active_ownership_collision");
  assert.equal(result.nextAction, "RESOLVE_BLOCKER_AND_REFRESH");
});

test("non-monotonic audit history cannot be used for recovery", () => {
  const one = buildAutonomousAuditEvent({
    runId: RUN,
    sequence: 2,
    eventType: "VALIDATION",
    issue: 687,
    reason: "later",
  });
  const two = buildAutonomousAuditEvent({
    runId: RUN,
    sequence: 1,
    eventType: "CLAIM",
    issue: 687,
    reason: "earlier",
  });
  const result = planAutonomousRunRecovery({
    runId: RUN,
    auditHistory: [one, two],
    executionDecision: { decision: "RESUME_IMPLEMENTATION" },
  });
  assert.equal(result.decision, "STOP");
  assert.equal(result.reason, "audit_sequence_not_monotonic");
});
