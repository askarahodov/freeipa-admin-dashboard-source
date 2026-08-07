# Unified Data-List Pattern — Design

Date: 2026-08-07  
Issue: #95  
Epic: #92  
Depends on: #93

## Goal

Create one calm, scalable page grammar for administrative collections such as Users, Groups, Operations, Approvals, Sessions and Audit without changing their API/query/RBAC contracts.

## Product pattern

Every collection page should read in the same order:

1. page identity and primary action;
2. search/filter/action toolbar;
3. optional compact summary/context;
4. data table/list;
5. explicit loading/empty/filtered-empty/error/forbidden state;
6. pagination in one predictable location.

The pattern is table-first for large operational datasets. It must not turn every row into a decorative card on narrow screens.

## Components

Create domain-agnostic composition units under `app/ui/data-list/`:

- `DataListPage` — PageHeader + optional Toolbar + content + footer composition;
- `DataTable` — semantic native `<table>` inside a controlled horizontal overflow boundary;
- `DataListState` — loading/empty/error/forbidden informational surface;
- `Pagination` — compact previous/next/page summary controls.

These components consume #93 primitives/tokens and know nothing about FreeIPA, XYOps, RBAC permissions, fetch calls or URL state.

## DataTable behavior

- native table semantics remain intact;
- horizontal overflow is allowed for dense datasets;
- header is visually quiet, sticky behavior is not introduced until real page usage proves it useful;
- rows use compact consistent density;
- status/action columns are visually subordinate to identity columns;
- no row hover lift or card conversion;
- caller owns columns and row rendering so domain models do not leak into the shared layer.

## DataListState

Kinds:

- `loading`;
- `empty`;
- `filtered-empty`;
- `error`;
- `forbidden`.

Each state requires a title and may have a description/action. Error and forbidden use semantic tone but do not expose raw backend internals. Loading uses text/progress semantics rather than fake content metrics.

## Pagination

Props:

- current page;
- total pages;
- optional total items;
- previous/next callbacks;
- optional page-size text supplied by caller.

Rules:

- disabled controls at boundaries;
- `aria-label` for navigation;
- current position conveyed in text, not color;
- no page-number explosion in first version; previous/next plus exact page summary is enough for admin workflows.

## Responsive behavior

- page header/actions wrap using #93 primitives;
- toolbar wraps without changing control hierarchy;
- table remains a table and scrolls horizontally where necessary;
- pagination wraps but stays beneath the dataset;
- no CSS fixed positioning or mobile card transformation.

## Integration sequencing

The eventual migration order stays:

1. Users — reference implementation;
2. Groups — replace main group catalog card-grid with table/list while keeping detail view;
3. Operations — reuse the same toolbar/table/footer grammar without touching run safety behavior.

Because `app/page.tsx` is currently a large shared file and connector writes replace whole files, this branch first lands the reusable pattern and source contracts. Page migration is performed only with safe targeted editing, not by overwriting the monolith during parallel agent work.

## Accessibility

- table uses native semantics;
- state messages use suitable status/alert roles without abusing live regions;
- pagination has a named navigation landmark;
- controls retain visible focus;
- no information relies only on color;
- horizontal scrolling remains keyboard/trackpad reachable.

## Testing

Source contracts verify:

- no domain/API/storage imports or fetch;
- native `<table>` structure is preserved;
- pagination exposes named navigation and disabled boundaries;
- state kinds are explicit;
- shared CSS consumes #93 tokens;
- no `translateY`, persistent shadows or forced card conversion;
- narrow CSS uses overflow/wrap, not fixed overlays.

## Non-goals

- changing query APIs;
- adding a client-side data-grid framework;
- virtualizing rows before measured need;
- column customization/persistence;
- bulk-action business logic;
- rewriting Users/Groups/Operations in this connector-only phase;
- visual redesign of entity detail dialogs (#96).

## Acceptance summary

The slice succeeds when future collection pages can share one accessible table/list grammar and state/pagination structure without creating feature-specific page chrome or another visual system.
