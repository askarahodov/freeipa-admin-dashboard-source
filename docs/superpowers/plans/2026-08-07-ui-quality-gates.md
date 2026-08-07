# UI quality gates implementation plan

Issue #98 / Epic #92 / Related #33

1. Add source-level UI policy/contrast tests first.
2. Add reusable Node helper for token parsing, luminance and contrast.
3. Scan canonical shared UI CSS directories dynamically for prohibited decorative patterns.
4. Add Playwright UI-quality spec to the existing Auth E2E suite rather than creating a second suite.
5. Verify login and authenticated navigation with keyboard focus and desktop/tablet/narrow viewports.
6. Guard visible test content against credentials and internal-host-like fixtures.
7. Open a draft PR against main and inspect CI/Auth E2E evidence.
8. Add targeted screenshot baselines only after #94–#97 components are actually rendered in product routes.
