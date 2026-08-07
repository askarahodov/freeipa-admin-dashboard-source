# Agent Branch Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely retire proven-obsolete `agent/*` branches while preserving every active, stacked, superseded, changed-after-merge or otherwise unproven branch.

**Architecture:** A pure Node module classifies repository branch/PR metadata without credentials. A privileged GitHub Actions workflow reads only trusted `main` code, builds the plan from GitHub metadata, reports every decision, and deletes only branches proven to be exact merged PR heads and unused by open PRs.

**Tech Stack:** Node.js ESM, `node:test`, GitHub Actions, `actions/github-script`, GitHub REST metadata.

## Global Constraints

- Never delete by branch age.
- Never automatically delete a branch referenced by an open PR as head or base.
- Never automatically delete a closed-unmerged/superseded branch.
- A deletable branch must be `agent/*` and its current SHA must exactly equal a merged PR head SHA.
- Privileged workflow code must come from trusted `main`, never PR head.
- Workflow checkout must use `persist-credentials: false`.
- No `pull_request_target`.
- No force-push or history rewriting.

---

### Task 1: Pure branch classification

**Files:**
- Create: `scripts/agent-branch-hygiene.mjs`
- Test: `tests/agent-branch-hygiene.test.mjs`

**Interfaces:**
- Produces: `buildAgentBranchHygienePlan({ branches, openPullRequests, closedPullRequests })`
- Produces: `formatAgentBranchHygieneReport(plan)`

- [ ] **Step 1: Write failing behavior tests**

Cover exact merged-head deletion, changed branch tips, active PR head/base protection, closed-unmerged protection and no-PR protection.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/agent-branch-hygiene.test.mjs
```

Expected: failure because `scripts/agent-branch-hygiene.mjs` does not exist.

- [ ] **Step 3: Implement the minimal classifier**

The classifier normalizes refs/SHA values, builds a set of active open-PR head/base refs, indexes closed PR evidence by head ref, and emits one fixed action/reason per `agent/*` branch.

- [ ] **Step 4: Verify GREEN**

Run the same focused test and require zero failures.

- [ ] **Step 5: Commit**

Commit behavior tests before implementation, then implementation separately so RED/GREEN history remains reviewable.

### Task 2: Privileged cleanup workflow boundary

**Files:**
- Create: `.github/workflows/agent-branch-hygiene.yml`
- Modify: `tests/agent-branch-hygiene.test.mjs`

**Interfaces:**
- Consumes: `buildAgentBranchHygienePlan` and `formatAgentBranchHygieneReport`
- GitHub metadata input: current branches plus paginated open/closed PRs

- [ ] **Step 1: Add workflow source-contract tests before the workflow exists**

Require:

- workflow name `Agent Branch Hygiene`;
- `contents: write` and `pull-requests: read`;
- explicit checkout of `main`;
- `persist-credentials: false`;
- no `pull_request_target`;
- official `actions/github-script` client;
- paginated branch/open/closed PR discovery;
- classifier delegation;
- `deleteRef` only for entries classified `DELETE_MERGED`.

- [ ] **Step 2: Verify RED**

Expected: focused test fails with missing `.github/workflows/agent-branch-hygiene.yml`.

- [ ] **Step 3: Add workflow**

Use `pull_request` closed, weekly schedule and manual dispatch. Checkout trusted `main`, gather metadata, classify, report, then delete only exact planned refs.

- [ ] **Step 4: Verify GREEN**

Run the focused test and require zero failures.

### Task 3: Branch lifecycle documentation

**Files:**
- Create: `.github/AGENT_BRANCH_POLICY.md`
- Modify: `tests/agent-branch-hygiene.test.mjs`

**Interfaces:**
- Documents `agent/<short-scope>`, one active implementation PR per issue unless explicitly stacked, clean replay/supersede semantics, and automatic merged-head cleanup.

- [ ] **Step 1: Extend test contract to require the policy file and safety statements**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Add policy document**
- [ ] **Step 4: Verify GREEN**

### Task 4: Exact candidate verification

- [ ] **Step 1:** Compare branch against current `main`; replay if unrelated concurrent changes entered the diff.
- [ ] **Step 2:** Open a draft PR referencing #135.
- [ ] **Step 3:** Run/observe focused tests, normal CI and Auth E2E on the exact candidate head.
- [ ] **Step 4:** Keep PR draft if any required check is queued/failing or if branch diverges from current `main`.
- [ ] **Step 5:** Mark ready and merge only after exact-head verification succeeds.

### Task 5: Post-merge hygiene evidence

- [ ] **Step 1:** Observe the first `Agent Branch Hygiene` run from `main`.
- [ ] **Step 2:** Confirm active stack branches are retained.
- [ ] **Step 3:** Confirm at least one historical exact merged PR head is deleted if such candidates remain.
- [ ] **Step 4:** Record unresolved `INVESTIGATE` branches in #135; do not auto-delete them.