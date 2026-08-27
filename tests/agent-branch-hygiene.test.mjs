import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAgentBranchHygienePlan,
  formatAgentBranchHygieneReport,
} from "../scripts/agent-branch-hygiene.mjs";

const branch = (name, sha) => ({ name, sha });
const pr = (number, { merged = false, head, headSha, base = "main" }) => ({
  number,
  merged,
  head,
  headSha,
  base,
});

test("deletes only merged agent branch whose current tip matches merged PR head", () => {
  const plan = buildAgentBranchHygienePlan({
    branches: [
      branch("agent/merged", "aaa"),
      branch("agent/advanced-after-merge", "bbb-new"),
      branch("main", "main"),
    ],
    openPullRequests: [],
    closedPullRequests: [
      pr(10, { merged: true, head: "agent/merged", headSha: "aaa" }),
      pr(11, { merged: true, head: "agent/advanced-after-merge", headSha: "bbb-old" }),
    ],
  });

  assert.deepEqual(plan, [
    { branch: "agent/advanced-after-merge", action: "INVESTIGATE", reason: "branch_tip_changed_after_closed_pr" },
    {
      branch: "agent/merged",
      action: "DELETE_MERGED",
      reason: "exact_merged_pr_head",
      expectedSha: "aaa",
    },
  ]);
});

test("keeps any agent branch used by an open PR as head or base", () => {
  const plan = buildAgentBranchHygienePlan({
    branches: [
      branch("agent/open-head", "a"),
      branch("agent/open-base", "b"),
    ],
    openPullRequests: [
      pr(20, { head: "agent/open-head", headSha: "a" }),
      pr(21, { head: "agent/child", headSha: "c", base: "agent/open-base" }),
    ],
    closedPullRequests: [],
  });

  assert.deepEqual(plan, [
    { branch: "agent/open-base", action: "KEEP_ACTIVE", reason: "referenced_by_open_pr" },
    { branch: "agent/open-head", action: "KEEP_ACTIVE", reason: "referenced_by_open_pr" },
  ]);
});

test("never auto-deletes closed unmerged or untracked branches", () => {
  const plan = buildAgentBranchHygienePlan({
    branches: [
      branch("agent/superseded", "x"),
      branch("agent/untracked", "y"),
    ],
    openPullRequests: [],
    closedPullRequests: [
      pr(30, { merged: false, head: "agent/superseded", headSha: "x" }),
    ],
  });

  assert.deepEqual(plan, [
    { branch: "agent/superseded", action: "INVESTIGATE", reason: "closed_unmerged_pr" },
    { branch: "agent/untracked", action: "INVESTIGATE", reason: "no_pr_evidence" },
  ]);
});

test("report is deterministic and exposes only fixed branch decisions", () => {
  const report = formatAgentBranchHygieneReport([
    { branch: "agent/merged", action: "DELETE_MERGED", reason: "exact_merged_pr_head", expectedSha: "aaa" },
    { branch: "agent/open", action: "KEEP_ACTIVE", reason: "referenced_by_open_pr" },
    { branch: "agent/unknown", action: "INVESTIGATE", reason: "no_pr_evidence" },
  ]);

  assert.equal(
    report,
    [
      "Agent branch hygiene: delete=1, keep=1, investigate=1",
      "DELETE_MERGED agent/merged (exact_merged_pr_head)",
      "KEEP_ACTIVE agent/open (referenced_by_open_pr)",
      "INVESTIGATE agent/unknown (no_pr_evidence)",
      "",
    ].join("\n"),
  );
});

test("workflow executes only trusted-main cleanup policy", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/agent-branch-hygiene.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /^name:\s*Agent Branch Hygiene/mu);
  assert.match(workflow, /contents:\s*write/u);
  assert.match(workflow, /pull-requests:\s*read/u);
  assert.match(workflow, /ref:\s*main/u);
  assert.match(workflow, /persist-credentials:\s*false/u);
  assert.doesNotMatch(workflow, /pull_request_target/u);
  assert.match(workflow, /actions\/github-script@v9/u);
  assert.match(workflow, /github\.paginate\(github\.rest\.repos\.listBranches/u);
  assert.match(workflow, /github\.paginate\(github\.rest\.pulls\.list/u);
  assert.match(workflow, /buildAgentBranchHygienePlan/u);
  assert.match(workflow, /entry\.action !== "DELETE_MERGED"/u);
  assert.match(workflow, /github\.rest\.git\.getRef/u);
  assert.match(workflow, /entry\.expectedSha/u);
  assert.match(workflow, /freshOpenRefs\.has\(entry\.branch\)/u);
  assert.match(workflow, /github\.rest\.git\.deleteRef/u);
});

test("agent branch policy documents lifecycle and supersede safety", async () => {
  const policy = await readFile(new URL("../.github/AGENT_BRANCH_POLICY.md", import.meta.url), "utf8");
  assert.match(policy, /agent\/<short-scope>/u);
  assert.match(policy, /open PR/u);
  assert.match(policy, /stack/u);
  assert.match(policy, /exact merged PR head/u);
  assert.match(policy, /closed-unmerged/u);
  assert.match(policy, /never.*age/isu);
  assert.match(policy, /clean replay/u);
});
