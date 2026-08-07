# Agent PR Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every pull request to expose enough ownership, overlap, and dependency information for safe multi-agent coordination.

**Architecture:** Extend the existing PR template as the contributor-facing coordination form and the existing AI entrypoint as its usage contract. Add one focused executable test that validates the observable form fields without introducing a second ownership registry.

**Tech Stack:** Markdown, Node.js 22 built-in test runner, GitHub pull request templates.

## Global Constraints

- Preserve GitHub Issues and pull requests as coordination records.
- Preserve canonical runtime ownership in code and `docs/SOURCE_OF_TRUTH.md`.
- Do not modify collision-guard scripts/workflows or branch-hygiene files owned by other active branches.
- Do not change product/runtime/security behavior.

---

### Task 1: Add the coordination form contract

**Files:**
- Modify: `.github/pull_request_template.md`
- Create: `tests/pr-coordination-template.test.mjs`

**Interfaces:**
- Consumes: the repository's default GitHub pull request template.
- Produces: visible fields for Issue, canonical owner, high-conflict paths, dependencies, parallel-safe work, excluded scope, active-PR inspection, and overlap disposition.

- [ ] **Step 1: Write the failing behavior test**

Create a Node test that reads the default template, extracts the `## Coordination` section, and asserts that a contributor can fill each required field and record both checklist decisions.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/pr-coordination-template.test.mjs`

Expected: FAIL because the current template has no `Coordination` section.

- [ ] **Step 3: Add the minimal template section**

Add concise Markdown fields and two checklist items before `Source-of-truth review`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/pr-coordination-template.test.mjs`

Expected: PASS.

### Task 2: Document agent usage

**Files:**
- Modify: `docs/ai/README.md`

**Interfaces:**
- Consumes: the coordination fields introduced by Task 1.
- Produces: one explicit pre-change and PR-handoff protocol for agents.

- [ ] **Step 1: Extend the existing parallel-agent section**

Describe each coordination field, require explicit `none`, and explain how to record overlap ordering without claiming ownership through documentation.

- [ ] **Step 2: Run relevant documentation and focused tests**

Run: `node --test tests/pr-coordination-template.test.mjs tests/documentation-architecture-map.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run repository verification**

Run: `npm run lint && npm run build`

Expected: both commands exit 0; existing lint warnings, if any, are reported accurately.
