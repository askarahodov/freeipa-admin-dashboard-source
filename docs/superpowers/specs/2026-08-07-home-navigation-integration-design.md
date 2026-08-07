# Home Navigation Integration Design

## Context

Issue #118 requires behavior-preserving decomposition of `app/page.tsx` before broader UI integration. PR #127 already introduced the pure canonical navigation boundary in `app/shell/home-navigation.ts`, but `app/page.tsx` still duplicates the same page type, canonical paths, path-to-state resolution, and state-to-path building inline.

This duplication defeats the purpose of the extracted boundary and keeps the high-conflict monolith as a second navigation owner.

## Goal

Make `app/shell/home-navigation.ts` the single UI navigation contract used by the current Home orchestrator without changing any URL, History API behavior, automation-category behavior, backend request, RBAC rule, polling cadence, visual presentation, or E2E selector.

## Scope

### Included

- import the existing `HomePage` type, `buildHomePath()` and `resolveHomeLocation()` into `app/page.tsx`;
- remove the duplicate page union and `pagePaths` constant from `app/page.tsx`;
- make `navigateTo()` delegate path construction to `buildHomePath()` while preserving the existing category-state normalization;
- make the `popstate`/initial-location effect delegate path resolution to `resolveHomeLocation()`;
- add a focused source integration contract proving the monolith no longer owns a second route table/parser.

### Excluded

- AppShell/sidebar redesign or #94 integration;
- screen extraction beyond navigation ownership;
- Next.js router migration;
- new routes or route renames;
- generated XYOps categories in global navigation;
- API, RBAC, security, FreeIPA, XYOps or settings behavior changes;
- visual/CSS changes;
- changes to `app/shell/home-navigation.ts` semantics unless a regression is demonstrated.

## Behavioral invariants

The integration must preserve:

- `/` -> Overview;
- `/automation` -> Automation / all categories;
- `/automation/:known-slug` -> Automation / matching generated category;
- `/automation/:unknown-slug` -> Automation / all categories;
- `/users`, `/groups`, `/operations`, `/approvals`, `/audit`, `/settings` exactly as today;
- trailing slash normalization;
- unknown paths fall back to Overview;
- History API `pushState` / `replaceState` usage;
- query reset on explicit navigation;
- generated category selection only when the category exists.

## Architecture

`app/shell/home-navigation.ts` remains a pure dependency-free navigation domain module. `app/page.tsx` remains the current UI composition/orchestration owner but becomes a consumer rather than a second route contract owner.

No new state manager, router, service, helper file or navigation model is introduced.

## Verification

TDD RED adds a source integration contract that initially fails because `app/page.tsx` still declares `pagePaths` and manually parses `/automation` paths.

GREEN requires:

- import/use of `buildHomePath` and `resolveHomeLocation`;
- no local `pagePaths` declaration;
- no `Object.entries(pagePaths)` parsing;
- existing pure home-navigation contract tests remain green;
- full bounded CI and Auth E2E remain green;
- PR Collision Guard confirms no active ownership collision on `app/page.tsx`.

This is the smallest safe integration slice after #127 and remains part of #118.