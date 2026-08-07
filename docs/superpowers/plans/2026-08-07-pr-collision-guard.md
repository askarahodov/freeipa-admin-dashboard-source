# PR Collision Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only GitHub pull-request collision guard that blocks overlapping canonical/high-conflict ownership surfaces while allowing ordinary parallel work.

**Architecture:** A dependency-free Node.js module owns path policy, deterministic overlap analysis and report formatting. A thin CLI layer reads open PR metadata/files from the GitHub REST API. A dedicated pull-request workflow invokes the CLI with read-only permissions; tests exercise the pure layer without network access.

**Tech Stack:** Node.js 22.13.0, native `fetch`, `node:test`, GitHub Actions.

## Global Constraints

- Do not change runtime/UI/API behavior.
- Do not introduce a persistent ownership registry or new npm dependency.
- Workflow permissions are limited to `contents: read` and `pull-requests: read`.
- Do not log credentials, PR bodies, patches or source contents from other PRs.
- Exact candidate head must pass focused tests plus repository lint/build/CI.

---

### Task 1: Define collision policy and analysis contract with TDD

**Files:**
- Create: `tests/pr-collision-guard.test.mjs`
- Create later: `scripts/pr-collision-guard.mjs`

**Interfaces:**
- Produces from implementation: `isHighConflictPath(path: string): boolean`
- Produces from implementation: `analyzePullRequestCollisions({ currentPrNumber, currentFiles, pullRequests }): { overlaps, blocking }`
- `pullRequests` entries: `{ number, title, base, state, files }`

- [ ] **Step 1: Write the failing test**

Create tests that import the future script and assert exact files, prefix paths, informational overlaps, planning-document behavior, current-PR exclusion and deterministic ordering.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pr-collision-guard.test.mjs`

Expected: FAIL because `scripts/pr-collision-guard.mjs` does not exist yet.

- [ ] **Step 3: Implement minimal pure policy/analysis layer**

Create `scripts/pr-collision-guard.mjs` with immutable exact/prefix policy sets, normalized POSIX repository paths, filtered comparison against open PRs based on `main`, deduplicated overlap entries and deterministic sorting.

- [ ] **Step 4: Run focused test**

Run: `node --test tests/pr-collision-guard.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(ci): add PR ownership collision analysis`

---

### Task 2: Add read-only GitHub API CLI and workflow

**Files:**
- Modify: `scripts/pr-collision-guard.mjs`
- Create: `.github/workflows/pr-collision-guard.yml`
- Modify: `tests/pr-collision-guard.test.mjs`

**Interfaces:**
- Produces: `formatCollisionReport(result): string`
- Produces CLI environment contract: `GITHUB_REPOSITORY`, `GITHUB_TOKEN`, `GITHUB_EVENT_PATH`

- [ ] **Step 1: Add failing formatting/CLI-boundary tests**

Test stable no-overlap, informational and blocking report strings without network calls.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/pr-collision-guard.test.mjs`

Expected: FAIL because the formatting/CLI helpers are not implemented.

- [ ] **Step 3: Implement GitHub API pagination and CLI**

Use native `fetch` against `https://api.github.com/repos/{repo}/pulls?state=open&base=main&per_page=100&page=N` and `/pulls/{number}/files?per_page=100&page=N`, check non-2xx responses, exclude current PR and pass only metadata/path lists into the pure analyzer.

- [ ] **Step 4: Add workflow**

Create a `pull_request` workflow targeting `main` with permissions:

```yaml
permissions:
  contents: read
  pull-requests: read
```

Use Node 22.13.0 and run:

```bash
node scripts/pr-collision-guard.mjs
```

with `GITHUB_TOKEN: ${{ github.token }}`.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/pr-collision-guard.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `ci: enforce PR ownership collision guard`

---

### Task 3: Document the check and remediation

**Files:**
- Modify: `.github/REQUIRED_CHECKS.md`
- Modify: `docs/ai/README.md`

**Interfaces:**
- Documents stable check: `PR Collision Guard / ownership-collision`

- [ ] **Step 1: Update required-check documentation**

Add the third stable PR check, explain blocking vs informational overlap and the read-only permission model.

- [ ] **Step 2: Update AI coordination rules**

State that agents must not bypass a collision failure; they must establish dependency/order, narrow scope, or replay after the owner merges.

- [ ] **Step 3: Run relevant documentation/source tests**

Run: `node --test tests/pr-collision-guard.test.mjs tests/auth-e2e-routing.test.mjs`

Expected: PASS.

- [ ] **Step 4: Commit**

Commit message: `docs: document PR collision coordination gate`

---

### Task 4: Final verification and PR

**Files:**
- No new production files.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/pr-collision-guard.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Run complete repository tests when practical**

Run: `node --experimental-strip-types --test --test-concurrency=1 tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 5: Open a draft PR**

PR must link #134, list exact validation evidence, explain that the workflow is read-only, and note any currently open PR collision discovered by the new check.

- [ ] **Step 6: Verify GitHub Actions on exact head**

Required existing checks plus the new collision check must complete successfully or expose a real ownership collision that is resolved before merge.