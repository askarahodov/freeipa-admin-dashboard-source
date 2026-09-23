import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateProductionAcceptanceReleaseDecision,
  productionAcceptanceReleaseStagePolicies,
  validateProductionAcceptanceWaiverRegistry,
} from "../../scripts/production-acceptance-release-policy.mjs";
import { productionAcceptanceScenarioDefinitions } from "../../scripts/production-acceptance-scenarios.mjs";

const core = [
  { id: "compose_start", outcome: "passed", code: "compose_started" },
  { id: "baseline", outcome: "passed", code: "baseline_healthy" },
  { id: "cleanup", outcome: "passed", code: "cleanup_complete" },
];

function registry(waivers = []) {
  return { schemaVersion: 1, waivers };
}

function waiver(stageId, overrides = {}) {
  return {
    id: `waiver-${stageId.replaceAll("_", "-")}`,
    stageId,
    owner: "release-owner",
    reason: "Temporary external dependency outage",
    approvalRef: "#61",
    expiresAt: "2026-09-30T00:00:00Z",
    ...overrides,
  };
}

test("every executable scenario stage is registered in release policy", () => {
  const policyIds = new Set(productionAcceptanceReleaseStagePolicies.map((item) => item.id));
  const definitions = productionAcceptanceScenarioDefinitions({
    includeLocalAuthP0: true,
    includeSettings: true,
    includeFreeIpaMutations: true,
    includeXyOpsLifecycle: true,
    includeBackupRestore: true,
    includeUpgrade: true,
  });
  for (const definition of definitions) {
    assert.equal(policyIds.has(definition.id), true, `missing release policy for ${definition.id}`);
  }
});

test("release policy has unique explicit stage ownership", () => {
  const ids = productionAcceptanceReleaseStagePolicies.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    productionAcceptanceReleaseStagePolicies
      .filter((item) => item.waivable)
      .map((item) => item.id),
    [
      "freeipa_read",
      "freeipa_crud_membership",
      "xyops_read",
      "xyops_approval_cancel_result",
    ],
  );
  assert.equal(
    productionAcceptanceReleaseStagePolicies
      .find((item) => item.id === "previous_supported_upgrade")?.waivable,
    false,
  );
});

test("all selected passed stages produce a passed release decision", () => {
  const result = evaluateProductionAcceptanceReleaseDecision({
    stages: [
      ...core.slice(0, 2),
      { id: "local_auth_rbac", outcome: "passed", code: "local_auth_rbac_passed" },
      { id: "p0_operational", outcome: "passed", code: "p0_operational_passed" },
      core[2],
    ],
    selectedStageIds: ["local_auth_rbac", "p0_operational"],
    now: () => new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(result.outcome, "passed");
  assert.equal(result.exceptionCount, 0);
});

test("optional external dependency skips are explicit and produce passed_with_exceptions", () => {
  const result = evaluateProductionAcceptanceReleaseDecision({
    stages: [
      ...core.slice(0, 2),
      { id: "freeipa_read", outcome: "skipped", code: "dependency_unavailable" },
      { id: "xyops_read", outcome: "skipped", code: "dependency_unconfigured" },
      core[2],
    ],
    selectedStageIds: ["freeipa_read", "xyops_read"],
    now: () => new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(result.outcome, "passed_with_exceptions");
  assert.equal(result.exceptionCount, 2);
  assert.deepEqual(result.decisions.map((item) => item.decision), [
    "passed", "passed", "skipped", "skipped", "passed",
  ]);
});

test("missing or arbitrary skip evidence fails closed", () => {
  const missing = evaluateProductionAcceptanceReleaseDecision({
    stages: core,
    selectedStageIds: ["settings_persistence_rollback"],
    now: () => new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(missing.outcome, "failed");
  assert.equal(
    missing.decisions.find((item) => item.id === "settings_persistence_rollback")?.code,
    "required_stage_missing",
  );

  const invalidSkip = evaluateProductionAcceptanceReleaseDecision({
    stages: [
      ...core.slice(0, 2),
      { id: "freeipa_read", outcome: "skipped", code: "operator_did_not_feel_like_it" },
      core[2],
    ],
    selectedStageIds: ["freeipa_read"],
    now: () => new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(invalidSkip.outcome, "failed");
});

test("time-bounded owned waiver can cover only an allowed external stage", () => {
  const result = evaluateProductionAcceptanceReleaseDecision({
    stages: [
      ...core.slice(0, 2),
      { id: "freeipa_read", outcome: "failed", code: "acceptance_freeipa_read_failed" },
      core[2],
    ],
    selectedStageIds: ["freeipa_read"],
    waiverRegistry: registry([waiver("freeipa_read")]),
    now: () => new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(result.outcome, "passed_with_exceptions");
  const decision = result.decisions.find((item) => item.id === "freeipa_read");
  assert.equal(decision.decision, "waived");
  assert.equal(decision.waiverOwner, "release-owner");
  assert.equal(decision.waiverApprovalRef, "#61");
});

test("expired waiver blocks release", () => {
  const result = evaluateProductionAcceptanceReleaseDecision({
    stages: [
      ...core.slice(0, 2),
      { id: "xyops_read", outcome: "failed", code: "acceptance_xyops_read_failed" },
      core[2],
    ],
    selectedStageIds: ["xyops_read"],
    waiverRegistry: registry([waiver("xyops_read", { expiresAt: "2026-09-22T00:00:00Z" })]),
    now: () => new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(result.outcome, "failed");
  assert.equal(
    result.decisions.find((item) => item.id === "xyops_read")?.code,
    "waiver_expired",
  );
});

test("cleanup, schema baseline and upgrade are non-waivable", () => {
  assert.throws(
    () => validateProductionAcceptanceWaiverRegistry(registry([waiver("cleanup")])),
    /acceptance_waiver_stage_nonwaivable/u,
  );
  assert.throws(
    () => validateProductionAcceptanceWaiverRegistry(registry([waiver("previous_supported_upgrade")])),
    /acceptance_waiver_stage_nonwaivable/u,
  );

  const upgrade = evaluateProductionAcceptanceReleaseDecision({
    stages: [
      ...core.slice(0, 2),
      {
        id: "previous_supported_upgrade",
        outcome: "skipped",
        code: "dependency_unconfigured",
      },
      core[2],
    ],
    selectedStageIds: ["previous_supported_upgrade"],
    now: () => new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(upgrade.outcome, "failed");
  assert.equal(
    upgrade.decisions.find((item) => item.id === "previous_supported_upgrade")?.code,
    "stage_skip_not_allowed",
  );
});

test("waiver registry rejects ambiguous or unsafe ownership metadata", () => {
  assert.throws(
    () => validateProductionAcceptanceWaiverRegistry({
      schemaVersion: 1,
      waivers: [waiver("freeipa_read", { owner: "" })],
    }),
    /acceptance_waiver_owner_invalid/u,
  );
  assert.throws(
    () => validateProductionAcceptanceWaiverRegistry({
      schemaVersion: 1,
      waivers: [waiver("freeipa_read", { reason: "short" })],
    }),
    /acceptance_waiver_reason_invalid/u,
  );
  assert.throws(
    () => validateProductionAcceptanceWaiverRegistry({
      schemaVersion: 1,
      waivers: [waiver("freeipa_read"), waiver("freeipa_read", { id: "waiver-second" })],
    }),
    /acceptance_waiver_duplicate_stage/u,
  );
});
