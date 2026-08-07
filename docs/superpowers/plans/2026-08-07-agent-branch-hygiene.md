# Agent Branch Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Safely retire proven-obsolete `agent/*` branches while preserving every active, stacked, superseded, changed-after-merge or otherwise unproven branch.

**Architecture:** A pure Node module classifies repository branch/PR metadata without credentials. A privileged GitHub Actions workflow reads only trusted `main` code, builds the plan from GitHub metadata, reports every decision, and deletes only branches proven to be exact merged PR heads and unused by open PRs.

**Tech Stack:** Node.js ESM, `node:test`, GitHub Actions, `actions/github-script`, GitHub REST metadata.

## Constraints

- Never delete by branch age.
- Never automatically delete a branch referenced by an open PR as head or base.
- Never automatically delete a closed-unmerged/superseded branch.
- A deletable branch must be `agent/*` and its current SHA must exactly equal a merged PR head SHA.
- Privileged workflow code must come from trusted `main`, never PR head.
- Workflow checkout must use `persist-credentials: false`.
- No `pull_request_target`.
- No force-push or history rewriting.
- The candidate must pass the PR Collision Guard installed by #159.

## Tasks

### 1. Pure classification

- [x] Preserve original RED evidence from superseded #140.
- [x] Replay `scripts/agent-branch-hygiene.mjs`.
- [x] Replay behavior/report tests.

### 2. Privileged workflow boundary

- [x] Preserve original workflow-boundary RED evidence from superseded #140.
- [x] Replay trusted-main workflow with `contents: write`, `pull-requests: read`, `persist-credentials: false`, and no `pull_request_target`.
- [x] Recheck active open PR refs and exact branch SHA immediately before deletion.

### 3. Branch lifecycle policy

- [x] Replay `.github/AGENT_BRANCH_POLICY.md`.
- [x] Preserve stack protection, clean replay rules, closed-unmerged preservation and no-age-deletion contract.

### 4. Current-main verification

- [ ] Compare branch against current `main` and require only the intended six files.
- [ ] Open one clean draft PR that closes #135 and supersedes #140.
- [ ] Require `PR Collision Guard / ownership-collision` success.
- [ ] Require bounded `CI / Required CI` and `Auth E2E / auth-e2e` success on exact head.
- [ ] Recheck current `main`, review threads and exact head SHA before merge.

### 5. Post-merge cleanup evidence

- [ ] Observe the first `Agent Branch Hygiene` run from trusted `main`.
- [ ] Confirm active stacked runtime head/base branches remain `KEEP_ACTIVE`.
- [ ] Confirm only `DELETE_MERGED / exact_merged_pr_head` branches are removed.
- [ ] Record remaining `INVESTIGATE` branches in #135; never auto-delete them.

## Evidence lineage

Superseded #140 retains the original RED/GREEN progression and focused 6/6 contract evidence. This replay exists so the privileged workflow is introduced only after #151 bounded CI and #159 Collision Guard are present on `main`.
