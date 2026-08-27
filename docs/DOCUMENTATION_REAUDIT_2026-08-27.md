# Documentation re-audit — 2026-08-27

Issue: #207

Baseline: `main` after merge of #210 (`f4514e2224b2e5091f6856d1513b2c4ced6c9fda`), with fixes and verification performed on PR #211.

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

### AUDIT-207-03 — configuration reference legacy production bootstrap — fixed in #211

`docs/reference/CONFIGURATION.md` previously pointed `PORT` and the internal FreeIPA Gateway bootstrap at `scripts/start-worker.mjs`, including the legacy temporary env-file lifecycle.

The re-audit verified the current owner in `scripts/start-production.mjs`:

- `HOST` defaults to `0.0.0.0` and `PORT` to `3001` in the canonical Node startup path;
- the Gateway token is generated in-process;
- the Gateway binds to `127.0.0.1`;
- `IPA_NODE_GATEWAY_URL` and `IPA_NODE_GATEWAY_TOKEN` are injected directly into the runtime environment object;
- the legacy child-runtime temporary env-file mechanism is not the canonical production bootstrap.

The configuration reference now reflects that behavior and preserves the stable invariant that ephemeral Gateway values must not be added to `.env.example` as persistent operator secrets.

### AUDIT-207-04 — UI architecture documentation-contract test was stale — fixed by #210

The documentation architecture test still required claims that AppShell/Home integration had not happened and `app/page.tsx` was untouched. Merged #199–#201 changed that state. #210 updated the test to assert the current extracted presentation/screen ownership instead of preserving historical wording.

### AUDIT-207-05 — source-of-truth registry described already-created references as future work — fixed in #211

`docs/SOURCE_OF_TRUTH.md` still said that the canonical configuration reference and full project/module ownership map were future work. The re-audit verified that `docs/reference/CONFIGURATION.md` and `docs/PROJECT_STRUCTURE.md` already exist and are active current-state references. The registry now points to them directly while still documenting the remaining machine-readable configuration-registry gap tracked by #123.

### AUDIT-207-06 — security model retained obsolete Wrangler limitation — fixed in #211

`docs/SECURITY_MODEL.md` still listed the Wrangler development command / #51 replacement as a current limitation after #194 had already moved production startup to the canonical Node runtime. The obsolete limitation was removed and the document now states that the Node production path is current state.

### AUDIT-207-07 — API and RBAC normalized references — verified

`docs/reference/API.md` was checked against its canonical route-metadata owner `portal-route-contract.ts`, route handlers/wrappers and the documentation reference tests. `docs/reference/PERMISSIONS.md` was checked against `portal-permissions.ts` and the same reference-test layer. No new confirmed drift was found in these two references during this re-audit.

The CI documentation-reference checks also verify canonical permission ordering and known literal storage route constants.

## Verification scope completed in #211

The highest-risk documents affected by recent runtime/configuration/UI changes were re-checked and corrected where necessary:

1. `docs/ARCHITECTURE.md` / `docs/PROJECT_STRUCTURE.md` — corrected by #210;
2. `docs/reference/CONFIGURATION.md` — corrected in #211;
3. `docs/SOURCE_OF_TRUTH.md` — corrected in #211;
4. `docs/SECURITY_MODEL.md` — corrected in #211;
5. `docs/reference/API.md` — re-verified against current route ownership/tests;
6. `docs/reference/PERMISSIONS.md` — re-verified against canonical RBAC owner/tests;
7. `docs/DOCUMENTATION_INVENTORY.md` — reconciled to an explicit verification baseline.

The remaining active runbooks/reference documents were not found to be directly invalidated by #194–#201 during this focused re-audit. Their `verified-active` status remains conditional on the inventory rule: any change to their canonical owner requires re-verification on the exact merge candidate.

## Open runtime/deployment defect

#209 remains open. Until it is fixed and tested, documentation must not imply that the existing Compose named-volume mount persists the canonical `/data` production database path.

## Verification rule after #207

- `verified-active` is always relative to a recorded baseline/ref, never a permanent claim;
- a change to runtime, configuration, security, deployment, API, UI ownership, or a referenced canonical owner invalidates the affected verification until re-checked;
- machine-checkable documentation contracts should be covered by tests/CI rather than prose-only convention;
- historical `docs/superpowers/**` plans/specs remain non-authoritative for current runtime behavior;
- #209 remains explicitly tracked until fixed in deployment/runtime code and regression-tested.
