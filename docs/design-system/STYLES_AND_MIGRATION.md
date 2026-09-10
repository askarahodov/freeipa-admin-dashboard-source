# Style layers and migration policy

This document records the **current** style ownership model for Admin Dashboard Softrust and the migration/deprecation policy for design-system work. It exists to prevent two opposite mistakes: treating every root/global stylesheet as canonical forever, or declaring an actively consumed stylesheet deprecated merely because a newer token layer exists.

Issue #293 owns this documentation policy. Product-screen migration remains with the owning UI issue unless a bounded design-system change is explicitly agreed.

## Current source hierarchy

The repository currently has two shared styling generations plus feature-owned styles. They coexist on `main` and must be described honestly.

| Layer | Current owner/evidence | Status | Rule for new work |
| --- | --- | --- | --- |
| `app/styles/tokens.css` | imported by modern shared UI CSS modules such as `app/ui/ui.module.css` | canonical modern shared token foundation | Prefer semantic `--ui-*` tokens for new/updated shared primitives. |
| `app/ui/**/*.module.css` | shared primitive/form/data-list implementations | canonical shared component styling | Extend the existing primitive owner rather than copying its rules into feature CSS. |
| `app/globals.css` | root layout global import | active global application foundation | Keep global/page-wide rules here only when they are genuinely cross-product; do not use it as a dumping ground for a single feature. |
| `app/design-system.css` | root layout imports it last; file defines `--ds-*` variables and broad selectors across settings, modal, FreeIPA, access and other surfaces | active compatibility/global override layer; **not removed or deprecated as a file yet** | Do not expand it with a second generation of shared tokens when a `--ui-*`/shared primitive solution exists. Migrate bounded consumers before retiring selectors/tokens. |
| `app/directory/*.css`, `app/operations/*.css`, `app/diagnostics/*.css` | feature owners established by #540 | current feature-owned styles | Keep feature-specific layout/presentation with the feature; use shared tokens/primitives for reusable semantics. |
| root feature styles imported by `app/layout.tsx` | active consumers include auth/session/settings/access/global interaction surfaces | transitional or active feature/global owners depending on surface | Do not mass-move or delete. Migrate only with the owning feature issue and preserve global import order where cascade matters. |

The presence of both `--ui-*` and `--ds-*` variables is current-state technical debt, not evidence that either set can be renamed or removed globally in a documentation-only change.

## Token ownership

### Modern shared tokens: `--ui-*`

[`../../app/styles/tokens.css`](../../app/styles/tokens.css) is the canonical token source for the modern public primitives exported from `app/ui`. The shared `ui.module.css` imports this file and uses its semantic typography, color, spacing, radius, control-size and focus tokens.

For **new shared primitive work**, prefer the semantic `--ui-*` vocabulary. A literal color/spacing value should not be promoted into a new shared token unless it represents a reusable semantic role across multiple consumers.

### Compatibility/global tokens: `--ds-*`

[`../../app/design-system.css`](../../app/design-system.css) remains an active global stylesheet. It is imported by [`../../app/layout.tsx`](../../app/layout.tsx) after other global feature styles and explicitly relies on that cascade position. It defines a separate `--ds-*` token family and broad selectors for many historical/current surfaces.

Therefore:

- `--ds-*` is **not** documented as removed or unsupported today;
- new modern shared primitives should not add dependencies on `--ds-*` when an equivalent `--ui-*` semantic token exists;
- an existing `--ds-*` consumer must not be mechanically renamed to `--ui-*`: values, specificity and cascade behavior may differ;
- retirement requires a consumer inventory, visual/behavioral parity and routed browser validation.

This distinction fixes the misleading idea that every shared token on current `main` already lives in `tokens.css`.

## What “deprecated” means here

A style/token/pattern is only **deprecated** when all of the following are recorded:

1. the old owner or selector/token family is identified;
2. a canonical replacement exists on current `main`;
3. the owning issue/PR states the migration boundary;
4. remaining consumers are known or machine-searchable;
5. removal conditions and verification are stated.

“Old-looking”, “root-level”, “few consumers”, or “a newer component exists” are not sufficient deprecation evidence.

Until those conditions are met, use one of these terms instead:

- **canonical** — preferred current owner for new work;
- **active compatibility** — still required by current consumers/cascade, but not preferred for new shared abstractions;
- **feature-owned** — correct local owner, even if the file is global CSS for framework reasons;
- **transitional** — intended to move with a named owner/workstream, but still supported on current `main`.

## Migration rules

### Shared primitive migration

When a feature duplicates a semantic control already represented by `Button`, `IconButton`, `TextInput`, `Select`, `Alert`, `StatusBadge`, form compositions or data-list compositions:

1. identify the real product behavior and all states;
2. prove the existing shared primitive can represent them without weakening semantics;
3. migrate one bounded feature family at a time;
4. remove only the selectors made unreachable by that migration;
5. verify keyboard/focus/responsive behavior and routed browser flows;
6. update this design-system documentation when public API or recommended composition changes.

Do not change a feature’s DOM, mutation/API contract, RBAC or destructive confirmation semantics merely to reduce CSS lines.

### Global-selector migration

For selectors in `app/design-system.css` or other global files:

1. inventory every matching surface before editing the selector;
2. confirm whether the rule intentionally overrides earlier feature CSS;
3. move the consumer to a canonical primitive/token or feature-owned rule;
4. verify the consuming screens in the same PR;
5. delete the old global selector only when no supported surface relies on it.

Because `app/design-system.css` is intentionally imported late, moving or deleting a rule can change behavior even when computed declarations look similar in isolation.

### Feature stylesheet relocation

#540 already moved independent FreeIPA, operations and diagnostics style families under their feature owners. Remaining root styles should not be mechanically relocated under #293. In particular:

- settings-related files remain coordinated with #27;
- Overview presentation remains coordinated with #97;
- global form/dialog adoption remains coordinated with #96;
- semantic color/icon adoption remains coordinated with #279;
- brand assets/identity remain coordinated with #291.

A style file may remain at root because of framework/global import mechanics while its **semantic owner** is a feature issue. Physical location and semantic ownership are related but not identical.

## Current root-layout style inventory

[`../../app/layout.tsx`](../../app/layout.tsx) currently imports the following broad groups in explicit order:

### Global/foundation

- `globals.css`;
- `focus-ring.css`;
- `design-system.css` (late compatibility/global override layer).

### Auth/session/access and cross-route administration

- `local-auth.css`;
- `local-auth-enhancements.css`;
- `sessions.css`;
- `local-administration-context.css`;
- `local-admin-session.css`;
- `portal-interaction-layer.css`.

These are active current consumers. Do not label them deprecated without a feature-specific replacement and owner evidence.

### Settings

- `settings-tabs.css`;
- `settings-policy-editors.css`;
- `settings-lifecycle.css`;
- `settings-source-resets.css`.

Settings route/navigation restructuring is owned by #27. #293 may document shared primitives used by settings, but must not pre-empt that route migration by declaring these files removable.

### Feature-local families already grouped

- `diagnostics/diagnostics.css`;
- `directory/freeipa-user-browser.css`;
- `directory/freeipa-user-bulk.css`;
- `directory/freeipa-group-member-browser.css`;
- `operations/operation-explorer.css`.

These files were grouped under their feature owners during #540. Their existence is not design-system duplication by itself; shared tokens/primitives and feature-specific layout can coexist.

## Replacement guidance

When the duplicated concern is specifically one of these roles, the current preferred owner is:

| Concern | Preferred owner |
| --- | --- |
| semantic spacing/color/type/focus token for a shared primitive | `app/styles/tokens.css` (`--ui-*`) |
| buttons/icon buttons | `app/ui/Button.tsx`, `app/ui/IconButton.tsx` |
| input/select visual shell | `app/ui/TextInput.tsx`, `app/ui/Select.tsx` |
| status/feedback presentation | `app/ui/StatusBadge.tsx`, `app/ui/Alert.tsx`, Toast contract as appropriate |
| page heading/actions | `app/ui/PageHeader.tsx` |
| generic toolbar layout | `app/ui/Toolbar.tsx` |
| form label/help/error structure | `app/ui/forms/FormField.tsx` |
| dialog shell/focus lifecycle | `app/ui/forms/Dialog.tsx` + `DialogFooter.tsx` |
| list-page structure/states/table/pagination | `app/ui/data-list/*` |
| cross-route shell/navigation | `app/shell/*` |
| feature-specific layout or domain presentation | owning feature folder/issue |

A replacement is valid only if it preserves the consuming flow’s semantics. Similar appearance is not enough.

## Relationship to #279 and #291

#279 owns product-language normalization, semantic status colors, icon semantics and affordance consistency. #293 documents the design-system vocabulary and replacement rules but does not silently implement #279’s cross-product visual changes.

#291 owns logo/brand identity, asset variants and brand usage. Brand marks must not become functional action/navigation icons. #293 should link the eventual approved brand rules rather than inventing an interim identity system.

Both issues are currently separate product workstreams; their future merged contracts should be incorporated into this documentation in the same change that makes them current on `main`.

## Removal checklist

Before deleting a legacy/compatibility selector, token or style file, verify:

- current `app/layout.tsx` and component imports no longer require it;
- code/literal-path/source-reading tests have been updated deliberately;
- there is no framework/global cascade requirement left;
- replacement uses a canonical shared or feature owner;
- affected browser flows pass keyboard/focus/responsive checks;
- screenshots/visual comparisons use sanitized deterministic data where applicable;
- no API/RBAC/state/destructive-operation behavior changed as collateral cleanup;
- documentation no longer presents the old owner as current.

If any item cannot be proven, retain the current style and record the owning follow-up instead of performing speculative cleanup.
