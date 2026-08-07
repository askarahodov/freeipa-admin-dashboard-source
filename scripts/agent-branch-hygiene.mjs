function normalizeRef(value) {
  return String(value ?? "").trim().replace(/^refs\/heads\//u, "");
}

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isAgentBranch(name) {
  return normalizeRef(name).startsWith("agent/");
}

export function buildAgentBranchHygienePlan({ branches, openPullRequests, closedPullRequests }) {
  const openRefs = new Set();
  for (const pullRequest of openPullRequests ?? []) {
    const head = normalizeRef(pullRequest?.head);
    const base = normalizeRef(pullRequest?.base);
    if (isAgentBranch(head)) openRefs.add(head);
    if (isAgentBranch(base)) openRefs.add(base);
  }

  const closedByHead = new Map();
  for (const pullRequest of closedPullRequests ?? []) {
    const head = normalizeRef(pullRequest?.head);
    if (!isAgentBranch(head)) continue;
    const entries = closedByHead.get(head) ?? [];
    entries.push({
      merged: pullRequest?.merged === true,
      headSha: normalizeSha(pullRequest?.headSha),
    });
    closedByHead.set(head, entries);
  }

  const plan = [];
  for (const branch of branches ?? []) {
    const name = normalizeRef(branch?.name);
    if (!isAgentBranch(name)) continue;
    const sha = normalizeSha(branch?.sha);

    if (openRefs.has(name)) {
      plan.push({ branch: name, action: "KEEP_ACTIVE", reason: "referenced_by_open_pr" });
      continue;
    }

    const closedEntries = closedByHead.get(name) ?? [];
    if (closedEntries.some((entry) => entry.merged && entry.headSha && entry.headSha === sha)) {
      plan.push({ branch: name, action: "DELETE_MERGED", reason: "exact_merged_pr_head" });
      continue;
    }

    if (closedEntries.length > 0) {
      const hasExactClosedHead = closedEntries.some((entry) => entry.headSha && entry.headSha === sha);
      plan.push({
        branch: name,
        action: "INVESTIGATE",
        reason: hasExactClosedHead ? "closed_unmerged_pr" : "branch_tip_changed_after_closed_pr",
      });
      continue;
    }

    plan.push({ branch: name, action: "INVESTIGATE", reason: "no_pr_evidence" });
  }

  return plan.sort((left, right) => left.branch.localeCompare(right.branch));
}

export function formatAgentBranchHygieneReport(plan) {
  const entries = Array.isArray(plan) ? plan : [];
  const counts = { DELETE_MERGED: 0, KEEP_ACTIVE: 0, INVESTIGATE: 0 };
  for (const entry of entries) counts[entry.action] = (counts[entry.action] ?? 0) + 1;

  const lines = [
    `Agent branch hygiene: delete=${counts.DELETE_MERGED}, keep=${counts.KEEP_ACTIVE}, investigate=${counts.INVESTIGATE}`,
  ];
  for (const entry of entries) lines.push(`${entry.action} ${entry.branch} (${entry.reason})`);
  return `${lines.join("\n")}\n`;
}
