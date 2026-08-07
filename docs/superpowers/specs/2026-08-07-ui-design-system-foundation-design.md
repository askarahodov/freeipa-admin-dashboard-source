# UI Design System Foundation — Design

Date: 2026-08-07  
Issue: #93  
Epic: #92

## Goal

Create a small, explicit UI foundation for Admin Dashboard Softrust so future frontend work composes existing presentation primitives instead of adding another independent CSS/interaction pattern for each feature.

This slice is deliberately narrow. It does not redesign the whole product, restructure navigation, split settings routes, or change backend/API/security behavior.

## Context

The current frontend already has a workable visual identity, but its presentation rules are distributed across `app/globals.css` and many feature-specific stylesheets. The application loads Geist fonts in `app/layout.tsx`, while `globals.css` currently sets Arial/Helvetica on `body`. Controls, radii, shadows, semantic colors, status presentation and icons are only partially normalized.

Two parallel PRs are active while this work starts:

- #90 owns product branding and currently touches `app/layout.tsx`, `app/login/page.tsx` and documentation;
- #91 owns CI/Auth E2E routing and workflow behavior.

A separate documentation agent is also updating active engineering documentation.

Therefore this slice must avoid those ownership areas until they merge.

## Design principles

### Calm Technical Workspace

The UI should feel like an operational admin console rather than a marketing dashboard.

- information hierarchy before decoration;
- border-first surfaces;
- restrained radii;
- almost no persistent shadows outside overlays;
- one primary accent;
- semantic colors only for semantic state;
- visible keyboard focus;
- compact but readable density;
- no movement/hover lift on important operational surfaces;
- no new decorative gradients as a default component treatment.

### Local, dependency-light system

The project does not need a large component framework for this foundation. Shared React primitives should remain thin and domain-agnostic. They must not know about FreeIPA, XYOps, RBAC, settings, fetch calls, routes or persistence.

## Foundation architecture

Introduce a presentation layer with two responsibilities:

1. **tokens** — canonical CSS custom properties for visual constants;
2. **primitives** — small React components that apply consistent semantics and styles.

Target shape:

```text
app/
  ui/
    Button.tsx
    IconButton.tsx
    TextInput.tsx
    Select.tsx
    StatusBadge.tsx
    Alert.tsx
    PageHeader.tsx
    Toolbar.tsx
    index.ts
  styles/
    tokens.css
    primitives.css
```

Exact filenames may be adjusted if an existing convention provides a better fit, but ownership must remain clear: tokens are presentation constants; primitives are reusable controls; domain components remain elsewhere.

## Tokens

Define CSS custom properties for:

### Typography

- sans family based on the already loaded Geist variable with safe system fallback;
- mono family based on Geist Mono;
- page title, section title, body, label and caption scales;
- normal/medium/semibold weights;
- consistent line heights.

The implementation must not edit `app/layout.tsx` while #90 is active. The token layer should consume the existing font CSS variables already placed on `body` by layout.

### Color

Canonical semantic names rather than feature names:

- canvas;
- surface;
- surface-subtle;
- text;
- text-muted;
- border;
- border-strong;
- primary / primary-hover / primary-subtle;
- success / success-subtle;
- warning / warning-subtle;
- danger / danger-subtle;
- info / info-subtle;
- focus-ring.

The existing violet identity remains the primary accent. Teal is not treated as a second product accent; it is used only where semantically justified.

### Shape and spacing

Use a small radius scale with moderate values, for example `4/6/8px` semantics for `sm/md/lg`. Avoid introducing large card radii as the new default.

Define a compact spacing scale and standard control heights sufficient for forms, toolbars and dense admin lists.

### Elevation

Ordinary panels have no shadow by default. Elevation tokens exist for overlays such as dialogs, popovers and menus only.

## Shared primitives

### Button

Variants:

- primary;
- secondary;
- danger;
- ghost.

Requirements:

- forwards native button props;
- clear disabled state;
- visible focus state;
- no domain logic;
- supports compact icon/text composition without owning an icon library.

### IconButton

- requires an accessible label;
- consistent square hit area;
- native button behavior;
- visible focus state.

### TextInput and Select

- forward native input/select props;
- support invalid state through ARIA/native semantics;
- styling only; field labels/help/errors remain a higher-level form concern for #96.

### StatusBadge

Semantic tones only: neutral, success, warning, danger, info, primary. Text must carry the state meaning; color is supplementary.

### Alert

Semantic surface for compact page/form feedback. It must not replace the existing request/error contract or introduce new error normalization.

### PageHeader and Toolbar

Layout primitives only. They standardize title/description/actions and search/filter/action placement for later #94/#95 slices.

## Icon strategy

Do not add a large icon framework in this first slice unless implementation proves the local approach is inadequate.

Preferred first step: create a tiny typed local SVG icon abstraction only for icons actually migrated in the reference component. The full primary-navigation migration belongs to #94 after branding PR #90 is merged.

No new Unicode glyph should be introduced as a primary UI icon source.

## Integration slice

The foundation must prove real usage without becoming a broad migration.

Choose one low-conflict existing UI surface that is not owned by #90/#91 and migrate only its generic controls/status presentation to the new primitives/tokens. The integration target should not change its data flow, routing, RBAC or API contract.

If all candidate files are being modified by another active PR at implementation time, it is acceptable for #93 to land primitives plus focused contract tests first and defer visible migration to the next slice. This must be explicit in the PR rather than forcing a conflict.

## Compatibility and behavior

This change must not alter:

- API routes or payloads;
- local authentication/session behavior;
- server-side RBAC;
- FreeIPA/XYOps execution flows;
- approval/destructive confirmation semantics;
- settings lifecycle;
- browser storage behavior;
- health/storage/recovery contracts.

Existing CSS class names may continue working during migration. Foundation is additive first; removal of obsolete styles happens only after consumers migrate and tests prove parity.

## Accessibility

All new interactive primitives must provide:

- keyboard operability inherited from native elements;
- `:focus-visible` treatment;
- disabled state that is visually and semantically clear;
- IconButton accessible naming;
- status text that does not rely only on color.

Full dialog focus management and broader accessibility gates are tracked in #96/#98.

## Testing

Add focused tests for the foundation rather than testing exact CSS pixels.

Minimum coverage:

- token source contains the required semantic categories;
- primitives do not import domain modules or perform fetch calls;
- Button variants and disabled semantics render as expected;
- IconButton requires/uses accessible naming;
- StatusBadge semantic tones map to stable class/attribute contracts;
- no new primary-control Unicode icon pattern is introduced in foundation code;
- existing relevant source/behavior tests continue to pass.

Run the repository's normal lint/build/test gates that apply to the changed files. Do not edit CI routing in this branch.

## Documentation coordination

This design file is the only documentation artifact intentionally added by the UI branch because the planning workflow requires a committed design. Do not update `docs/README.md`, `docs/SOURCE_OF_TRUTH.md`, `docs/DOCUMENTATION_INVENTORY.md`, documentation policy, or broad module docs in this PR. Record documentation impact in the PR so the documentation agent can incorporate any required active-document changes in its own ownership area.

## Rollout

1. Add tokens and primitive styles/components.
2. Add focused foundation tests.
3. Integrate one low-conflict presentation surface if safe.
4. Run lint/build/relevant tests.
5. Open a narrow PR linked to #93/#92.
6. Subsequent slices #94–#98 consume the foundation incrementally.

## Non-goals

- dark mode;
- theme editor;
- global redesign;
- AppShell/navigation refactor;
- settings route split;
- replacing every existing CSS file;
- introducing a full third-party design system;
- changing backend/security contracts.

## Acceptance summary

The slice is complete when there is one canonical token layer, a small reusable primitive set with accessible native semantics, no conflict with #90/#91 ownership, no domain coupling, and enough tests to prevent the project from immediately creating a second competing visual foundation.
