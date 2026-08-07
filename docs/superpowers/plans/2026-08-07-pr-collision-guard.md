# PR Collision Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only pull-request collision guard that blocks overlapping canonical/high-conflict ownership surfaces while allowing ordinary parallel work.

**Architecture:** Keep path policy, overlap analysis and formatting in a pure dependency-free Node.js module. Let a dedicated GitHub Actions workflow read open PR metadata/files through the official authenticated GitHub client and delegate decisions to the pure module.

**Tech Stack:** Node.js 22.13.0, `node:test`, GitHub Actions, `actions/github-script`.

## Global Constraints

- No runtime/UI/API/RBAC/database behavior changes.
- No persistent ownership registry or new npm dependency.
- Workflow permissions remain `contents: read` and `pull-requests: read`.
- No PR bodies, patches, source contents or credentials from other PRs in logs.
- Final verification occurs on a branch replayed from current `main`.

---

### Task 1: Pure ownership policy and analyzer

**Files:**
- Create: `scripts/pr-collision-guard.mjs`
- Create: `tests/pr-collision-guard.test.mjs`

**Interfaces:**
- `isHighConflictPath(path: string): boolean`
- `analyzePullRequestCollisions({ currentPrNumber, currentFiles, pullRequests }): { overlaps, blocking }`
- `formatCollisionReport(result): string`

- [x] **Step 1: Write failing contract tests before implementation.**

Tests import the future module and define exact/prefix policy, INFO/BLOCKING semantics, self exclusion, filtering, deduplication, ordering and report output.

- [x] **Step 2: Verify RED.**

Observed failure: `ERR_MODULE_NOT_FOUND` for `scripts/pr-collision-guard.mjs` before implementation existed.

- [x] **Step 3: Implement minimal pure analyzer.**

No network or credential handling belongs in the module.

- [x] **Step 4: Verify GREEN.**

Focused local reproduction: 8/8 analyzer/report tests passed.

---

### Task 2: Read-only GitHub workflow

**Files:**
- Create: `.github/workflows/pr-collision-guard.yml`
- Modify: `tests/pr-collision-guard.test.mjs`

**Interfaces:**
- Stable check: `PR Collision Guard / ownership-collision`
- Workflow delegates to the pure module.

- [x] **Step 1: Add workflow-boundary test before workflow.**

The test requires the workflow file, read-only permissions, official `actions/github-script`, PR/file pagination and delegation to `analyzePullRequestCollisions`/`formatCollisionReport`.

- [x] **Step 2: Verify RED.**

Observed failure: `ENOENT` for `.github/workflows/pr-collision-guard.yml` before the workflow existed.

- [x] **Step 3: Add workflow.**

Use `pull_request` targeting `main`, Node 22.13.0, `contents: read`, `pull-requests: read`, and the GitHub client exposed by `actions/github-script`.

- [ ] **Step 4: Verify workflow contract and real GitHub run on the clean replay PR.**

Expected: test passes; workflow reports actual overlaps and fails only on high-conflict exact path collisions.

---

### Task 3: Required-check documentation

**Files:**
- Modify: `.github/REQUIRED_CHECKS.md`

- [x] **Step 1: Document the third stable check.**

Explain blocking vs informational overlap, read-only permissions and remediation.

- [x] **Step 2: Keep documentation ownership narrow.**

Do not modify `docs/ai/README.md` in the clean replay; current `main` already owns the generic multi-agent rule and the detailed check contract belongs in `.github/REQUIRED_CHECKS.md`.

---

### Task 4: Final clean replay and verification

**Files:**
- Clean branch: `agent/pr-collision-guard-main`

- [x] **Step 1: Replay from current `main`.**

Avoid reintroducing already-merged reference-layer documentation from the original draft #136.

- [ ] **Step 2: Run/observe focused test in CI.**

Expected command: `node --test tests/pr-collision-guard.test.mjs` — PASS.

- [ ] **Step 3: Observe repository CI.**

Required existing checks must pass on exact candidate head.

- [ ] **Step 4: Observe real collision guard output.**

If blocking overlap exists, resolve ownership ordering instead of weakening policy.

- [ ] **Step 5: Open clean draft PR and close original draft #136 as superseded.**

New PR links #134 and records TDD evidence from the original draft plus exact clean-head CI evidence.