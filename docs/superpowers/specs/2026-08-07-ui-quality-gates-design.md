# UI quality gates design

Issue: #98  
Epic: #92  
Related: #33

## Goal

Add deterministic quality gates for the shared UI redesign without creating a competing full Playwright suite or pixel-perfect snapshots of the whole portal.

## Phase 1 in this branch

1. Mathematical WCAG contrast checks derived from canonical #93 tokens.
2. Shared-UI CSS policy scan for gradients, hover-lift transforms and non-overlay shadows.
3. Accessible-name contract for the shared IconButton primitive.
4. Real Playwright keyboard/focus checks on stable existing surfaces.
5. Desktop/tablet/narrow viewport checks using deterministic E2E identities.
6. Artifact-content guard: browser checks must use synthetic E2E identities and must not render credentials or known internal-host patterns in visible page text.

## Deferred until shared patterns are rendered in main

Targeted `toHaveScreenshot` baselines for:

- AppShell;
- list page;
- form/dialog;
- operational Overview.

Those baselines must be generated from deterministic mock state after the corresponding components are actually wired into product routes. Adding artificial showcase routes only to obtain screenshots is explicitly rejected.

## Contrast baseline

Minimum normal-text contrast is 4.5:1 for canonical text on white surface:

- main text;
- muted text;
- primary action text/background;
- danger;
- success;
- warning;
- info.

The test calculates luminance rather than hard-coding expected ratio strings.

## CSS policy scope

The scanner covers reusable redesign directories that exist at test time:

- `app/ui/**`;
- `app/shell/**`;
- `app/overview/**`.

This makes the gate automatically expand as #94–#97 land. Legacy `globals.css` is not scanned in phase 1 because it is precisely the migration source and would turn the gate into a permanent known failure.

Allowed elevation is only `var(--ui-shadow-overlay)` for actual overlay surfaces. Persistent card/control shadows are rejected.

## Browser checks

The existing Auth E2E Playwright environment remains authoritative. New checks live under `e2e/specs/` and therefore reuse the same isolated Compose fixtures, authentication and artifact handling.

No blind retries, external hosts or real production data are introduced.
