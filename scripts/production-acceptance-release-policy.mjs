const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const WAIVER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/u;
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.@/-]{1,119}$/u;
const APPROVAL_REF_PATTERN = /^(?:#[1-9]\d*|[A-Z][A-Z0-9_-]{1,31}-[1-9]\d*)$/u;

export const PRODUCTION_ACCEPTANCE_RELEASE_POLICY_VERSION = 1;
export const PRODUCTION_ACCEPTANCE_WAIVER_REGISTRY_VERSION = 1;

const policies = [
  ["compose_start", "required", false, []],
  ["baseline", "required", false, []],
  ["local_auth_rbac", "required", false, []],
  ["p0_operational", "required", false, []],
  ["settings_persistence_rollback", "required", false, []],
  ["freeipa_read", "optional-dependency", true, ["dependency_unconfigured", "dependency_unavailable"]],
  ["freeipa_crud_membership", "optional-dependency", true, ["dependency_unconfigured", "dependency_unavailable"]],
  ["xyops_read", "optional-dependency", true, ["dependency_unconfigured", "dependency_unavailable"]],
  ["xyops_approval_cancel_result", "optional-dependency", true, ["dependency_unconfigured", "dependency_unavailable"]],
  ["backup_restore_smoke", "required", false, []],
  ["previous_supported_upgrade", "required", false, []],
  ["cleanup", "required", false, []],
];

export const productionAcceptanceReleaseStagePolicies = Object.freeze(
  policies.map(([id, criticality, waivable, allowedSkipCodes]) => Object.freeze({
    id,
    criticality,
    waivable,
    allowedSkipCodes: Object.freeze([...allowedSkipCodes]),
  })),
);

const policyById = new Map(productionAcceptanceReleaseStagePolicies.map((item) => [item.id, item]));

function freezeDecisionItem(item) {
  return Object.freeze({ ...item });
}

function assertKnownStageId(stageId) {
  const normalized = String(stageId ?? "").trim();
  const policy = policyById.get(normalized);
  if (!policy) throw new Error("acceptance_release_stage_unknown");
  return policy;
}

function parseExpiry(value) {
  const normalized = String(value ?? "").trim();
  if (!ISO_TIMESTAMP_PATTERN.test(normalized)) throw new Error("acceptance_waiver_expiry_invalid");
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new Error("acceptance_waiver_expiry_invalid");
  return Object.freeze({ normalized, timestamp });
}

function normalizeWaiver(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("acceptance_waiver_invalid");
  }
  const keys = Object.keys(raw).sort();
  const expectedKeys = ["approvalRef", "expiresAt", "id", "owner", "reason", "stageId"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("acceptance_waiver_shape_invalid");
  }

  const id = String(raw.id ?? "").trim();
  const owner = String(raw.owner ?? "").trim();
  const reason = String(raw.reason ?? "").trim();
  const approvalRef = String(raw.approvalRef ?? "").trim();
  const policy = assertKnownStageId(raw.stageId);
  const expiry = parseExpiry(raw.expiresAt);

  if (!WAIVER_ID_PATTERN.test(id)) throw new Error("acceptance_waiver_id_invalid");
  if (!OWNER_PATTERN.test(owner)) throw new Error("acceptance_waiver_owner_invalid");
  if (reason.length < 8 || reason.length > 240 || /[\r\n]/u.test(reason)) {
    throw new Error("acceptance_waiver_reason_invalid");
  }
  if (!APPROVAL_REF_PATTERN.test(approvalRef)) throw new Error("acceptance_waiver_approval_ref_invalid");
  if (!policy.waivable) throw new Error("acceptance_waiver_stage_nonwaivable");

  return Object.freeze({
    id,
    stageId: policy.id,
    owner,
    reason,
    approvalRef,
    expiresAt: expiry.normalized,
    expiresAtMs: expiry.timestamp,
  });
}

export function validateProductionAcceptanceWaiverRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new Error("acceptance_waiver_registry_invalid");
  }
  if (registry.schemaVersion !== PRODUCTION_ACCEPTANCE_WAIVER_REGISTRY_VERSION) {
    throw new Error("acceptance_waiver_registry_version_unsupported");
  }
  if (!Array.isArray(registry.waivers)) throw new Error("acceptance_waiver_registry_invalid");

  const waivers = registry.waivers.map(normalizeWaiver);
  const ids = new Set();
  const stages = new Set();
  for (const waiver of waivers) {
    if (ids.has(waiver.id)) throw new Error("acceptance_waiver_duplicate_id");
    if (stages.has(waiver.stageId)) throw new Error("acceptance_waiver_duplicate_stage");
    ids.add(waiver.id);
    stages.add(waiver.stageId);
  }

  return Object.freeze({
    schemaVersion: PRODUCTION_ACCEPTANCE_WAIVER_REGISTRY_VERSION,
    waivers: Object.freeze(waivers),
  });
}

function normalizeSelectedStageIds(selectedStageIds) {
  if (!Array.isArray(selectedStageIds)) throw new Error("acceptance_release_selection_invalid");
  const result = [];
  const seen = new Set();
  for (const rawId of selectedStageIds) {
    const policy = assertKnownStageId(rawId);
    if (["compose_start", "baseline", "cleanup"].includes(policy.id)) {
      throw new Error("acceptance_release_selection_core_stage_forbidden");
    }
    if (seen.has(policy.id)) throw new Error("acceptance_release_selection_duplicate");
    seen.add(policy.id);
    result.push(policy.id);
  }
  return Object.freeze(result);
}

function normalizeStageEvidence(stages) {
  if (!Array.isArray(stages)) throw new Error("acceptance_release_stages_invalid");
  const map = new Map();
  for (const stage of stages) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw new Error("acceptance_release_stage_evidence_invalid");
    }
    const id = String(stage.id ?? "").trim();
    assertKnownStageId(id);
    if (map.has(id)) throw new Error("acceptance_release_stage_duplicate");
    const outcome = String(stage.outcome ?? "").trim();
    if (!["passed", "failed", "skipped"].includes(outcome)) {
      throw new Error("acceptance_release_stage_outcome_invalid");
    }
    const code = String(stage.code ?? "").trim();
    if (!code) throw new Error("acceptance_release_stage_code_invalid");
    map.set(id, Object.freeze({ id, outcome, code }));
  }
  return map;
}

function validWaiverForStage(waiver, stageId, nowMs) {
  return waiver
    && waiver.stageId === stageId
    && waiver.expiresAtMs > nowMs;
}

export function evaluateProductionAcceptanceReleaseDecision({
  stages,
  selectedStageIds = [],
  waiverRegistry = { schemaVersion: 1, waivers: [] },
  now = () => new Date(),
} = {}) {
  const selected = normalizeSelectedStageIds(selectedStageIds);
  const evidence = normalizeStageEvidence(stages);
  const registry = validateProductionAcceptanceWaiverRegistry(waiverRegistry);
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) throw new Error("acceptance_release_now_invalid");

  const requiredIds = Object.freeze(["compose_start", "baseline", ...selected, "cleanup"]);
  const decisions = [];
  let blocked = false;
  let exceptionCount = 0;

  for (const stageId of requiredIds) {
    const policy = assertKnownStageId(stageId);
    const stage = evidence.get(stageId);
    if (!stage) {
      blocked = true;
      decisions.push(freezeDecisionItem({
        id: stageId,
        decision: "blocked",
        code: "required_stage_missing",
      }));
      continue;
    }

    if (stage.outcome === "passed") {
      decisions.push(freezeDecisionItem({
        id: stageId,
        decision: "passed",
        code: stage.code,
      }));
      continue;
    }

    if (stage.outcome === "skipped") {
      if (policy.criticality === "optional-dependency" && policy.allowedSkipCodes.includes(stage.code)) {
        exceptionCount += 1;
        decisions.push(freezeDecisionItem({
          id: stageId,
          decision: "skipped",
          code: stage.code,
        }));
      } else {
        blocked = true;
        decisions.push(freezeDecisionItem({
          id: stageId,
          decision: "blocked",
          code: "stage_skip_not_allowed",
        }));
      }
      continue;
    }

    const waiver = registry.waivers.find((item) => item.stageId === stageId);
    if (policy.waivable && validWaiverForStage(waiver, stageId, nowMs)) {
      exceptionCount += 1;
      decisions.push(freezeDecisionItem({
        id: stageId,
        decision: "waived",
        code: stage.code,
        waiverId: waiver.id,
        waiverOwner: waiver.owner,
        waiverApprovalRef: waiver.approvalRef,
        waiverExpiresAt: waiver.expiresAt,
      }));
      continue;
    }

    blocked = true;
    decisions.push(freezeDecisionItem({
      id: stageId,
      decision: "blocked",
      code: waiver && waiver.expiresAtMs <= nowMs
        ? "waiver_expired"
        : policy.waivable
          ? "stage_failed_unwaived"
          : "stage_failed_nonwaivable",
    }));
  }

  return Object.freeze({
    schemaVersion: PRODUCTION_ACCEPTANCE_RELEASE_POLICY_VERSION,
    outcome: blocked ? "failed" : exceptionCount > 0 ? "passed_with_exceptions" : "passed",
    exceptionCount,
    decisions: Object.freeze(decisions),
  });
}
