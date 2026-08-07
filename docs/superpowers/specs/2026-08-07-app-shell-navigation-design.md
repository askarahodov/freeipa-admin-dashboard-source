# AppShell and Product Navigation — Design

Date: 2026-08-07  
Issue: #94  
Epic: #92  
Depends on: #93

## Goal

Extract the product-level shell and navigation language from the monolithic `app/page.tsx` into a small, stable and reusable frontend boundary.

The shell must remain calm and predictable as FreeIPA, XYOps and system-administration capabilities grow. Generated XYOps categories are content navigation inside Catalog and must never expand the global product sidebar.

## Current state

`app/page.tsx` currently owns all of the following in one component:

- product page identifiers and labels;
- Unicode navigation glyphs;
- sidebar rendering;
- generated XYOps category navigation nested inside the sidebar;
- topbar title/search/notifications/profile rendering;
- page-to-URL synchronization;
- domain data fetching and business state;
- content rendering for all major product areas.

The existing `navigateTo()` and `popstate` flow already provides useful deep-link/back-forward behavior. #94 must preserve that behavior rather than replacing routing and business state at the same time.

## Target boundary

```text
Home/domain state
  └─ AppShell
      ├─ ProductSidebar
      │   └─ stable PRODUCT_NAV_GROUPS
      ├─ ShellHeader
      │   ├─ title/description slots
      │   └─ search/notification/profile slots
      └─ content slot
```

The shell is **controlled presentation**. It does not fetch data, decide RBAC authority or own FreeIPA/XYOps state.

## Stable information architecture

### Overview

- Overview — `/`

### Directory

- Users — `/users`
- Groups — `/groups`

### Automation

- Catalog — `/automation`
- Operations — `/operations`
- Approvals — `/approvals`

### Security

- Access — `/access`
- Sessions — `/sessions`
- Audit — `/audit`

### System

- Diagnostics — `/diagnostics`

### Settings

- Settings — `/settings`

`Integrations` and `Storage` are deliberate future slots in the System group, but they are **not rendered as dead links** until #27/#44 provide real destinations. Adding them later must be a navigation-data change, not a sidebar redesign.

## Catalog navigation

Generated XYOps category sections are removed from product-navigation responsibility.

`/automation/<category-slug>` continues to work through the current `Home` routing logic, but category tabs/filters live inside `AutomationCatalog`. The sidebar only highlights Catalog for `/automation` and `/automation/*`.

## Navigation model

Introduce a typed, static navigation model under `app/shell/navigation.ts`.

Each item has:

- stable `id`;
- label;
- href;
- icon name from the local shell icon set;
- optional badge key;
- visibility metadata only if it is presentation-level.

RBAC authority remains server-side. The caller passes which item ids are visible; the shell only renders that list.

## Icon system

Primary navigation must stop using Unicode symbols such as `⌂`, `⌘`, `♙`, `♧`, `◷`, `✓`, `≣`, `⚙`.

Do not add a new icon-package dependency in this slice. Create a small typed local SVG set containing only icons used by product navigation:

- dashboard;
- users;
- groups;
- workflow/catalog;
- activity/operations;
- approval/shield-check;
- access/shield;
- sessions/monitor;
- audit/list;
- diagnostics/heartbeat;
- settings/cog.

SVGs use `currentColor`, `aria-hidden="true"` and a consistent 20px viewBox/stroke language. The navigation control owns the accessible text label.

## AppShell API

The shell must be reusable and domain-agnostic. Target shape:

```ts
interface AppShellProps {
  currentPath: string;
  visibleItemIds: readonly ProductNavItemId[];
  badges?: Partial<Record<ProductNavItemId, string | number>>;
  onNavigate: (item: ProductNavItem) => void;
  brand: ReactNode;
  systemStatus?: ReactNode;
  header: ReactNode;
  children: ReactNode;
}
```

The shell does not import FreeIPA, XYOps, permissions or API clients.

`currentPath` matching rules:

- `/` activates Overview only;
- exact href activates normal destinations;
- `/automation/*` activates Catalog;
- trailing slash does not change active state.

## Header responsibility

The existing topbar search, notification center and profile are not redesigned in this slice. They move into an explicit `header` slot/composition boundary first. A later migration can replace their legacy controls with #93 primitives without mixing shell extraction and behavior changes.

## Branding coordination

PR #90 still owns canonical product-branding copy and `app/layout.tsx` while this design starts. #94 must not introduce a second product name constant. Brand content is passed as a slot from the existing consumer until the rename work lands.

## Visual language

The shell consumes #93 tokens and follows Calm Technical Workspace principles:

- sidebar: solid dark neutral surface, no decorative gradient required;
- active item: restrained primary-subtle/primary treatment, no floating shadow;
- compact group labels;
- consistent SVG icon weight;
- no generated category tree in global navigation;
- no hover movement;
- visible focus ring;
- main content remains visually dominant.

## Responsive behavior

No overlay/hamburger state is required in this first shell extraction.

At narrow widths:

- shell becomes one column;
- sidebar becomes a compact static navigation region above content;
- navigation groups can scroll horizontally or wrap deliberately;
- content is never covered by navigation;
- focus order remains DOM order: navigation → header → content.

A later mobile-drawer enhancement is allowed only if usage proves it necessary.

## Accessibility

- navigation is a semantic `<nav aria-label="Основная навигация">`;
- group labels are text, not decorative headings that steal focus;
- current destination uses `aria-current="page"`;
- icon SVGs are `aria-hidden`;
- buttons/links retain visible `:focus-visible`;
- badges do not replace the item label;
- keyboard order follows visual order.

## Testing

Add source/behavior contracts for:

- no Unicode glyphs in primary navigation model/components;
- stable IA groups and current route hrefs;
- generated automation categories absent from product-nav API;
- `/automation/*` matching Catalog;
- `/` does not match every route;
- SVG icons use currentColor and are aria-hidden;
- AppShell contains no fetch/domain imports;
- nav uses `aria-current` and named `<nav>`;
- responsive CSS does not use fixed overlay positioning for the narrow sidebar.

Existing route/back-forward tests remain authoritative for `Home` behavior after integration.

## Integration strategy

Because `app/page.tsx` is a large high-conflict file and connector writes replace entire files, implementation is split deliberately:

1. land/test the independent shell/navigation/icon units on the stacked #94 branch;
2. do **not** overwrite the whole monolith through the connector merely to integrate them;
3. integrate `Home` only when a safe patch-capable workspace is available or when the relevant file can be updated without risking concurrent work;
4. keep the PR stacked on #93 until the foundation lands, then retarget/rebase safely.

This constraint is about repository safety, not a design compromise.

## Non-goals

- rewriting `Home` business state;
- changing API calls or RBAC;
- changing notification behavior;
- implementing #27 settings routes;
- creating Storage/Integrations dead routes;
- redesigning Catalog content;
- mobile drawer state;
- third-party icon library;
- global CSS rewrite.

## Acceptance summary

The shell design is successful when product navigation has one typed source of truth, SVG iconography, stable product groups, correct path matching, no generated XYOps category expansion and a controlled AppShell API that can replace the monolithic sidebar/topbar without taking ownership of domain logic.
