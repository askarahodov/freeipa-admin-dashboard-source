# XYOps Lifecycle Bridge Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the proven OperationExplorer-to-legacy-run race that makes XYOps details/cancellation rows fail to open while preserving the existing action/RBAC owner.

**Architecture:** Keep `OperationExplorer` as the enhanced read/filter surface and the legacy run details/action path as the mutation owner. Add a tiny pure coordinator for find → refresh → observable wait, then adapt it to the legacy DOM using `MutationObserver` and the existing refresh control.

**Tech Stack:** React/TypeScript, Node.js `node:test`, Playwright Auth E2E.

## Global Constraints

- Do not modify `app/page.tsx` in this slice.
- Do not add direct `/cancel` or `/rerun` calls to `OperationExplorer`.
- Do not increase Playwright retries/timeouts or add sleeps to mask the race.
- Keep exact job-id matching.
- Keep the existing dangerous-operation approval/cancel/result E2E assertions.
- Treat Workerd mutation 503/restarts as a separate remaining #117 boundary unless this slice produces direct evidence that it resolves them.

---

### Task 1: Pure bridge coordinator

**Files:**
- Create: `operation-explorer-legacy-bridge.ts`
- Create: `tests/operation-explorer-legacy-bridge.test.mjs`

**Interfaces:**
- Produces: `resolveLegacyOperationTarget<T>({ find, refresh, wait }): Promise<T | null>`

- [ ] **Step 1: Write the failing behavior tests**

Test three cases:

1. immediate target — returns it and never calls refresh/wait;
2. initially missing target — calls refresh once, awaits observer adapter, returns observed target;
3. observation returns null — returns null without repeated refresh loops.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test tests/operation-explorer-legacy-bridge.test.mjs
```

Expected: module-not-found because `operation-explorer-legacy-bridge.ts` does not exist.

- [ ] **Step 3: Implement the minimal coordinator**

```ts
export async function resolveLegacyOperationTarget<T>({
  find,
  refresh,
  wait,
}: {
  find: () => T | null;
  refresh: () => void | Promise<void>;
  wait: () => Promise<T | null>;
}): Promise<T | null> {
  const current = find();
  if (current) return current;
  await refresh();
  return wait();
}
```

- [ ] **Step 4: Verify GREEN**

Run the focused test and require zero failures.

### Task 2: Observable legacy DOM bridge

**Files:**
- Modify: `app/OperationExplorer.tsx`
- Modify: `tests/operation-explorer-ui.test.mjs`

**Interfaces:**
- Consumes: `resolveLegacyOperationTarget`
- Produces internal helpers:
  - `legacyRunRow(page, jobId)`
  - `requestLegacyRunsRefresh(page)`
  - `waitForLegacyRunRow(page, jobId, timeoutMs?)`
  - `openLegacyRun(page, jobId)`

- [ ] **Step 1: Strengthen the UI contract before production edit**

Require `OperationExplorer.tsx` to import/use `resolveLegacyOperationTarget`, use `MutationObserver`, invoke the existing legacy refresh control, await `openLegacyRun`, and remove the old synchronous one-shot error path.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/operation-explorer-ui.test.mjs
```

Expected: failure because current component only calls synchronous `clickLegacyRun`.

- [ ] **Step 3: Replace synchronous bridge**

Implement exact row lookup, non-competing refresh, bounded MutationObserver wait, and asynchronous open. Clear previous explorer error when the user retries a row.

- [ ] **Step 4: Verify focused GREEN**

Run both bridge and UI contracts.

### Task 3: Exact browser regression

**Files:**
- Prefer no changes to `e2e/specs/xyops-lifecycle.spec.mjs`; it is already the failing regression test.
- Modify only if additional sanitized diagnostic evidence is needed without changing behavior/assertions.

- [ ] **Step 1: Run the existing isolated lifecycle scenario**

Use the repository's existing Auth E2E environment. Do not add a sleep or retry.

- [ ] **Step 2: Verify the exact previously failing boundary**

After the enhanced row click, `.run-details-modal` must appear and the existing cancel flow must complete.

- [ ] **Step 3: Repeat isolated scenario**

Target at least 10 sequential isolated executions where runner capacity permits.

- [ ] **Step 4: Record runtime-only failures separately**

If Workerd still restarts or mutations return 503, keep #117 open and attach logs/trace. Do not change bridge semantics to hide runtime failures.

### Task 4: Candidate integration

- [ ] **Step 1:** Compare the branch to current `main`; clean replay if unrelated concurrent changes entered the diff.
- [ ] **Step 2:** Open a narrow draft PR referencing #117.
- [ ] **Step 3:** Require normal CI, Auth E2E and (after #137 merges) PR Collision Guard on the exact candidate head.
- [ ] **Step 4:** Keep PR draft while any required check is queued/failing or while runtime 503 evidence remains unexplained.
- [ ] **Step 5:** Merge only the proven bridge slice; do not close #117 unless both modal and Workerd restart acceptance criteria are satisfied.