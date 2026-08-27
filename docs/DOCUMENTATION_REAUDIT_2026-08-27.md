# Documentation re-audit — 2026-08-27

Issue: #207

Baseline: current `main` after merge of #210 (`f4514e2224b2e5091f6856d1513b2c4ced6c9fda`).

## Purpose

This audit re-validates documents marked `verified-active` against the current code/test owners. A `verified-active` label is not treated as permanent evidence: when a runtime, configuration, security, deployment, API or UI owner changes, the affected document must be checked again against the exact current implementation.

## Confirmed findings

### AUDIT-207-01 — production architecture drift — fixed by #210

Previous active architecture/project-structure documentation still described production startup through Wrangler / `scripts/start-worker.mjs` after the canonical Node production runtime cutover in #194.

Current owner verified against:

- `Dockerfile`;
- `scripts/start-production.mjs`;
- `runtime/production-runtime.mjs` and runtime database/host/scheduler/shutdown helpers;
- current runtime tests.

#210 corrected `docs/ARCHITECTURE.md`, `docs/PROJECT_STRUCTURE.md`, and the stale documentation architecture test.

### AUDIT-207-02 — Compose persistence contract mismatch — open as #209

The canonical production image/runtime uses `PORTAL_DATA_DIR=/data`, while current `compose.yaml` still mounts `dashboard-data` at `/app/.wrangler`.

This is a runtime/deployment defect, not something documentation should hide. Active documentation may describe the mismatch and point to #209, but must not claim that the current Compose mount persists the canonical Node production database until the deployment contract is fixed and regression-tested.

### AUDIT-207-03 — configuration reference still points at legacy production bootstrap — confirmed drift

`docs/reference/CONFIGURATION.md` currently contains legacy current-state ownership statements:

- `PORT` is described as defaulting to `3001` in `scripts/start-worker.mjs`;
- internal FreeIPA Gateway bootstrap is described as owned by `scripts/start-worker.mjs`, including a temporary env-file lifecycle.

Current `scripts/start-production.mjs` instead:

- defaults `HOST` to `0.0.0.0` and `PORT` to `3001` in the Node Worker host call;
- generates the high-entropy Gateway token in-process;
- starts the Gateway on `127.0.0.1`;
- injects `IPA_NODE_GATEWAY_URL` and `IPA_NODE_GATEWAY_TOKEN` directly into the runtime environment object;
- does not use the legacy child-runtime temporary env-file mechanism as the canonical production bootstrap.

Therefore `docs/reference/CONFIGURATION.md` must not retain `verified-active` semantics until these statements are corrected and the rest of the configuration table is re-checked against the post-#195 production configuration contract.

### AUDIT-207-04 — UI architecture documentation-contract test was stale — fixed by #210

The documentation architecture test still required claims that AppShell/Home integration had not happened and `app/page.tsx` was untouched. Merged #199–#201 changed that state. #210 updated the test to assert the current extracted presentation/screen ownership instead of preserving historical wording.

## Re-audit priority queue

The remaining `verified-active` documents are being checked in this order because recent changes most directly affect them:

1. `docs/reference/CONFIGURATION.md` and configuration/startup owners (#195/#196 and canonical Node runtime);
2. `docs/SOURCE_OF_TRUTH.md` and `docs/SECURITY_MODEL.md` for runtime/security owner pointers;
3. `docs/reference/API.md` and `docs/reference/PERMISSIONS.md` for route/RBAC ownership after recent changes;
4. deployment/recovery documents affected by #209 persistence alignment;
5. remaining operations/integration/reference documents;
6. `docs/DOCUMENTATION_INVENTORY.md` final status reconciliation.

## Verification rule for closing #207

Before #207 can be closed:

- each `verified-active` row in `docs/DOCUMENTATION_INVENTORY.md` must be checked against current `main` and its canonical owners/tests;
- confirmed drift must be fixed or the status must explicitly stop claiming current verification;
- the inventory must record a reproducible verification baseline (commit/ref or equivalent rule), not a timeless `verified-active` assertion;
- historical `docs/superpowers/**` plans/specs remain non-authoritative for current runtime behavior;
- #209 remains explicitly tracked as a runtime/deployment defect until fixed in code/Compose and tested.
