# XYOps Lifecycle E2E Stability Design

## Context

Issue #117 tracks repeated failures in the isolated Auth E2E suite. The same `xyops-lifecycle.spec.mjs` failure has reproduced on unrelated UI, documentation and GitHub-coordination branches, so it is not feature-diff specific.

Fresh trace evidence from Auth E2E run `31173805661` proves the missing-modal failure is not a Playwright click problem:

1. the enhanced `OperationExplorer` renders the newly created XYOps run and the row is visible/stable;
2. Playwright successfully clicks that exact row;
3. immediately after the click, the explorer replaces its table with `Операция <jobId> отсутствует в текущей legacy-таблице`;
4. `.run-details-modal` therefore never exists.

The current `OperationExplorer` owns its own `/api/integrations/runs` read model, while its click path delegates actions by synchronously finding the same job in the hidden legacy `.data-table`. A newly synchronized run can exist in the explorer's model before the legacy Home model performs its next refresh, creating a deterministic cross-model race.

The same Auth E2E artifact also contains Workerd `Broken pipe` / `Connection reset by peer` errors and one transient mutation HTTP 503. That runtime instability remains part of #117, but it is independent of the proven operation-row bridge bug and should not be masked with generic retries.

## Decision

Fix the proven bridge race in a narrow slice that does not touch `app/page.tsx` and does not duplicate cancel/rerun authorization or mutation behavior.

`OperationExplorer` will continue delegating the actual detail/action flow to the existing legacy owner. When the explorer row exists but the legacy row does not yet exist:

1. check for the exact legacy `jobId` immediately;
2. trigger the existing legacy journal refresh control if it is available and not already loading;
3. observe the legacy page subtree with `MutationObserver` for the exact row;
4. once the row appears, click it through the existing legacy path;
5. fail with the current bounded explorer error only if the exact row never appears within a short failure bound.

No arbitrary sleep, broad Playwright retry, direct `/cancel` or `/rerun` request, or second details/action implementation is introduced.

## Architecture

### Pure coordination helper

Create `operation-explorer-legacy-bridge.ts` with a small generic coordinator:

```ts
resolveLegacyOperationTarget({ find, refresh, wait })
```

It expresses only the sequencing contract:

- return an already-present target without refreshing;
- otherwise request refresh and await the observable target;
- return `null` if the observable target never appears.

It has no DOM, React, network or authorization knowledge and can be behavior-tested directly.

### DOM adapter in OperationExplorer

`app/OperationExplorer.tsx` keeps DOM-specific ownership:

- `legacyRunRow(page, jobId)` resolves `.data-table .tr.ops-detailed:not(.th)` by exact `.mono` job id;
- `requestLegacyRunsRefresh(page)` invokes the existing panel refresh button only when enabled;
- `waitForLegacyRunRow(page, jobId)` uses a `MutationObserver` and a bounded timeout only as a failure ceiling;
- `openLegacyRun(page, jobId)` composes these through the pure coordinator, then clicks the resolved row.

The enhanced explorer does not send mutation requests and does not create its own authorization/action semantics.

## Error semantics

If the legacy owner still cannot expose the exact run after refresh, retain an explicit explorer error containing the sanitized job id. The UI must not silently ignore the click or invent a fallback action.

If a legacy refresh is already in progress, the bridge does not start a competing request; it simply observes for the target row.

## Test strategy

### Existing RED behavior evidence

`e2e/specs/xyops-lifecycle.spec.mjs` is already the real regression test and has been observed failing on both initial execution and Playwright retry. The retained trace proves the click completes and the bridge error appears instead of `.run-details-modal`.

### Deterministic helper tests

Add focused Node behavior tests proving:

- existing target returns immediately and does not refresh;
- missing target invokes refresh exactly once and returns the asynchronously observed target;
- missing target remains `null` when observation fails.

### UI source contract

Update the existing operation-explorer integration contract to require the asynchronous bridge and to forbid the old one-shot `if (!clickLegacyRun(...)) setError(...)` behavior.

### Browser verification

The exact candidate must pass:

- focused helper/UI contracts;
- normal CI;
- Auth E2E;
- repeated isolated `xyops-lifecycle` executions when the CI environment permits repetition.

The destructive approval → run → details → cancel → cancelled-state → result-details assertions remain intact.

## Runtime 503 boundary

This slice does not claim to solve the separate Workerd restart/503 symptom. After the modal bridge fix is verified, #117 remains open if exact-head repeated runs still show mutation 503 or Workerd disconnects. That follow-up must be resolved at the runtime/E2E boundary, preferably in coordination with #51, rather than hidden with non-idempotent request retries.

## Scope boundaries

Not modified:

- `app/page.tsx`;
- Worker APIs;
- RBAC/permission owners;
- cancel/rerun endpoints;
- operation persistence schema;
- Playwright global retry/timeout policy;
- production runtime selection.
