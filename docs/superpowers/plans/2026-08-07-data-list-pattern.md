# Unified Data-List Pattern Implementation Plan

**Goal:** Add reusable, accessible collection-page composition primitives for #95 without changing domain behavior.

**Architecture:** Implement small components under `app/ui/data-list/` that compose the #93 foundation. They remain native-semantic and domain-agnostic. Existing page migrations are deferred until safe targeted editing of `app/page.tsx` is available.

## Constraints

- No fetch/API/RBAC/domain imports.
- No third-party data-grid.
- Preserve native table semantics.
- No card conversion on mobile.
- No fixed overlays, hover lift, decorative shadows or gradients.
- Pagination is previous/next + page summary in v1.
- Do not edit `app/page.tsx` through whole-file replacement.

### Task 1 — RED source contract

Create `tests/data-list-pattern.test.mjs` asserting the future files:

- exist;
- contain native `<table>` / `<thead>` / `<tbody>` composition capability;
- named pagination navigation exists;
- explicit `loading`, `empty`, `filtered-empty`, `error`, `forbidden` states exist;
- no `fetch(`, `FreeIPA`, `XYOps`, `/api/`, `localStorage` or `sessionStorage` coupling;
- CSS imports `../ui.module.css` indirectly only through components or directly imports `../../styles/tokens.css` and contains no `translateY(`, `box-shadow`, `position: fixed`.

Commit the failing contract before implementation.

### Task 2 — DataListPage and DataTable

Create:

- `app/ui/data-list/DataListPage.tsx`
- `app/ui/data-list/DataTable.tsx`
- `app/ui/data-list/data-list.module.css`

`DataListPage` accepts `title`, optional `description`, `actions`, `toolbar`, `children`, `footer` and composes #93 `PageHeader`.

`DataTable` forwards native `TableHTMLAttributes<HTMLTableElement>`, wraps the table in an overflow region and optionally accepts an accessible `label` used by the wrapper.

### Task 3 — DataListState and Pagination

Create:

- `app/ui/data-list/DataListState.tsx`
- `app/ui/data-list/Pagination.tsx`

`DataListStateKind = "loading" | "empty" | "filtered-empty" | "error" | "forbidden"`.

`Pagination` accepts `page`, `totalPages`, optional `totalItems`, `onPrevious`, `onNext`, optional `disabled`; clamps presentation to at least page 1 / totalPages 1 and disables boundary controls.

Use #93 `Button` for pagination controls.

### Task 4 — Public exports and GREEN

Create `app/ui/data-list/index.ts` and export the namespace from `app/ui/index.ts` only if a safe sequential update is possible on the isolated branch.

Run source contract in GitHub CI after opening stacked PR. Do not claim full build success before Actions evidence.

### Task 5 — Stacked draft PR

Open against `agent/ui-design-system-foundation`, not main. PR is phase 1 and does not close #95 until Users/Groups/Operations are actually migrated.
