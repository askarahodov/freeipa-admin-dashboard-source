# Home Navigation Integration Plan

**Goal:** Connect the existing pure Home navigation contract from #127 to `app/page.tsx` and remove duplicated route ownership without changing product behavior.

**Constraints:** one high-conflict file (`app/page.tsx`); no redesign; no API/RBAC/runtime changes; no new router/state manager; no changes to public URLs.

## Task 1 — RED integration contract

- Add `tests/home-navigation-integration.test.mjs`.
- Read `app/page.tsx` and assert it imports `buildHomePath` and `resolveHomeLocation` from `app/shell/home-navigation`.
- Assert the page no longer declares a local `pagePaths` route table.
- Assert it no longer performs `Object.entries(pagePaths)` path resolution or manually builds `/automation/${section.slug}` in `navigateTo`.
- Run the focused test; expected RED on current duplicated implementation.

## Task 2 — Minimal production integration

- Import `HomePage`, `buildHomePath`, `resolveHomeLocation`.
- Alias the local `Page` type to `HomePage` to avoid broad unrelated type churn.
- Remove local `pagePaths`.
- In `navigateTo`, preserve the current known-category lookup/state behavior and delegate only path generation to `buildHomePath`.
- In the location effect, replace manual pathname parsing with `resolveHomeLocation`.
- Do not edit JSX, CSS, fetches, mutations or state ownership.

## Task 3 — Focused verification

Run:

```bash
node --test tests/home-navigation-contract.test.mjs tests/home-navigation-integration.test.mjs
```

Require all tests green.

## Task 4 — Repository verification

Open a draft PR and require exact-head:

- `PR Collision Guard / ownership-collision`;
- `CI / Required CI`;
- `Auth E2E / auth-e2e`.

If Collision Guard reports another `app/page.tsx` owner, stop integration and restack rather than bypassing the guard.

## Task 5 — Merge gate

Before merge:

- fresh current-main compare;
- exact changed-file scope contains only plan/spec, focused test, and `app/page.tsx`;
- no unresolved review threads;
- all three required checks green on the current merge candidate.

Then squash-merge as the next #118 extraction slice.