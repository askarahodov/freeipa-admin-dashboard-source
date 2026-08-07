# Operational Overview implementation plan

Issue #97 / Epic #92

1. Add source-level contract tests first.
2. Add pure operational overview model using existing readiness/integration/run/approval inputs.
3. Add OperationalOverview presentational component using #93 primitives.
4. Add calm responsive CSS with row-based health/attention/operations sections.
5. Keep RBAC filtering caller-owned and render only supplied quick actions.
6. Exclude raw errors, URLs, secrets and diagnostics metadata from the component API.
7. Open a draft PR against `main`; do not overwrite `app/page.tsx` during concurrent work.
8. Integrate into Home only with a targeted safe patch after shell/list/form branches settle.
