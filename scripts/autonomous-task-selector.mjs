import { classifyAutonomousTaskIssue } from "./autonomous-task-state.mjs";

export const AUTONOMOUS_SELECTOR_CONTRACT_VERSION = 1;

const PRIORITY_ORDER = new Map([
  ["P0", 0],
  ["P1", 1],
  ["P2", 2],
  ["P3", 3],
]);

const RANK_FIELDS = Object.freeze([
  "securityCorrectness",
  "userOperationalImpact",
  "unlockValue",
  "implementationCost",
]);

function issueNumber(issue) {
  const value = Number(issue?.number ?? issue?.issue_number);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function collisionStatus(snapshot, number) {
  const raw = snapshot?.collisionEvidence?.[String(number)];
  return typeof raw === "string" ? raw : raw?.status;
}

function rankingEvidence(snapshot, number) {
  const raw = snapshot?.rankingEvidence?.[String(number)];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const normalized = {};
  for (const field of RANK_FIELDS) {
    const value = Number(raw[field]);
    if (!Number.isInteger(value) || value < 0 || value > 3) return null;
    normalized[field] = value;
  }
  return normalized;
}

function dependencyDecision(number, byNumber) {
  const dependency = byNumber.get(number);
  if (!dependency) return { ok: false, reason: "missing_dependency", dependency: number };

  const classified = classifyAutonomousTaskIssue(dependency);
  if (!classified.managed || !classified.valid) {
    return { ok: false, reason: "invalid_dependency_evidence", dependency: number };
  }
  if (classified.state !== "DONE") {
    return { ok: false, reason: "dependency_not_done", dependency: number, state: classified.state };
  }
  return { ok: true };
}

function compareCandidates(a, b) {
  return (
    a.ranking.securityCorrectness - b.ranking.securityCorrectness
    || a.ranking.userOperationalImpact - b.ranking.userOperationalImpact
    || a.ranking.unlockValue - b.ranking.unlockValue
    || a.priorityRank - b.priorityRank
    || a.ranking.implementationCost - b.ranking.implementationCost
    || a.issue - b.issue
  );
}

export function selectNextAutonomousTask(snapshot) {
  if (!snapshot || snapshot.githubAvailable !== true) {
    return { decision: "BLOCKED", reason: "github_state_unavailable", selected: null, rejected: [] };
  }
  if (typeof snapshot.mainSha !== "string" || snapshot.mainSha.length < 7) {
    return { decision: "BLOCKED", reason: "invalid_main_snapshot", selected: null, rejected: [] };
  }
  if (!Array.isArray(snapshot.issues) || !Array.isArray(snapshot.openPullRequests)) {
    return { decision: "BLOCKED", reason: "incomplete_github_snapshot", selected: null, rejected: [] };
  }
  if (!snapshot.collisionEvidence || typeof snapshot.collisionEvidence !== "object") {
    return { decision: "BLOCKED", reason: "collision_evidence_unavailable", selected: null, rejected: [] };
  }
  if (!snapshot.rankingEvidence || typeof snapshot.rankingEvidence !== "object") {
    return { decision: "BLOCKED", reason: "ranking_evidence_unavailable", selected: null, rejected: [] };
  }

  const byNumber = new Map();
  for (const issue of snapshot.issues) {
    const number = issueNumber(issue);
    if (number !== null) byNumber.set(number, issue);
  }

  const candidates = [];
  const rejected = [];

  for (const issue of snapshot.issues) {
    const number = issueNumber(issue);
    const classified = classifyAutonomousTaskIssue(issue);

    if (number === null) {
      rejected.push({ issue: null, reason: "invalid_issue_number" });
      continue;
    }
    if (!classified.managed) continue;
    if (!classified.valid) {
      rejected.push({ issue: number, reason: "invalid_task_state", details: classified.errors });
      continue;
    }
    if (classified.state !== "READY") continue;

    if (classified.metadata.humanApprovalRequired) {
      rejected.push({ issue: number, reason: "human_approval_required" });
      continue;
    }

    const blockedDependency = classified.metadata.dependsOn
      .map((dependency) => dependencyDecision(dependency, byNumber))
      .find((result) => !result.ok);
    if (blockedDependency) {
      rejected.push({ issue: number, ...blockedDependency });
      continue;
    }

    const collision = collisionStatus(snapshot, number);
    if (collision !== "clean") {
      rejected.push({
        issue: number,
        reason: collision === "collision" ? "active_ownership_collision" : "collision_evidence_not_clean",
        collision: collision ?? "missing",
      });
      continue;
    }

    const ranking = rankingEvidence(snapshot, number);
    if (!ranking) {
      rejected.push({ issue: number, reason: "ranking_evidence_not_valid" });
      continue;
    }

    candidates.push({
      issue: number,
      priority: classified.metadata.priority,
      priorityRank: PRIORITY_ORDER.get(classified.metadata.priority),
      ranking,
    });
  }

  candidates.sort(compareCandidates);

  if (candidates.length === 0) {
    return {
      decision: rejected.length > 0 ? "BLOCKED" : "NO_WORK",
      reason: rejected.length > 0 ? "no_executable_ready_issue" : "no_managed_ready_issue",
      selected: null,
      rejected,
      evidence: {
        contractVersion: AUTONOMOUS_SELECTOR_CONTRACT_VERSION,
        mainSha: snapshot.mainSha,
        openPullRequestCount: snapshot.openPullRequests.length,
      },
    };
  }

  const selected = candidates[0];
  return {
    decision: "SELECTED",
    reason: "highest_ranked_executable_issue",
    selected: {
      issue: selected.issue,
      priority: selected.priority,
      ranking: selected.ranking,
    },
    rejected,
    evidence: {
      contractVersion: AUTONOMOUS_SELECTOR_CONTRACT_VERSION,
      mainSha: snapshot.mainSha,
      openPullRequestCount: snapshot.openPullRequests.length,
    },
  };
}
