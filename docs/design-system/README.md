# Product design system

This document is the canonical developer-facing entrypoint for the **Admin Dashboard Softrust** design system. It describes the UI contracts that exist on the current repository ref; it is not a proposal for a second component library.

Issue #293 owns the living documentation and governance of this surface. Runtime behavior, authorization and domain rules remain owned by their existing code/tests.

## Sources of truth

Use these sources in this order when documentation and implementation disagree:

1. [`../../app/ui/index.ts`](../../app/ui/index.ts) — public shared-primitive exports.
2. [`../../app/ui/forms/index.ts`](../../app/ui/forms/index.ts) — shared form/dialog exports.
3. [`../../app/ui/data-list/index.ts`](../../app/ui/data-list/index.ts) — shared list/table exports.
4. [`../../app/styles/tokens.css`](../../app/styles/tokens.css) — modern `--ui-*` shared-token foundation; current compatibility/global style ownership is documented in [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md).
5. Individual component implementations and their tests — exact props, semantics and behavior.
6. This document — usage guidance and governance.

Do not copy a class, token value or implementation detail from a historical design/spec document and treat it as a current API.

## Design direction

The product uses a **Calm Technical Workspace** model: functional density, restrained decoration, predictable hierarchy, semantic status colors, visible focus and reusable interaction patterns. Product screens should compose existing primitives before introducing route-specific visual language.

A design-system change must not move authorization, approval, validation or destructive-operation safety from the server into the browser.

## Canonical tokens

The modern public shared primitives use the `--ui-*` token foundation in [`../../app/styles/tokens.css`](../../app/styles/tokens.css). Current `main` also retains an active `--ds-*` compatibility/global override layer in [`../../app/design-system.css`](../../app/design-system.css), which is imported late by the root layout and is **not** safe to describe as removed or deprecated yet. New shared primitive work should prefer semantic `--ui-*` tokens rather than copying literal values or expanding the compatibility token family.

| Token family | Current canonical `--ui-*` variables | Usage |
| --- | --- | --- |
| Typography | `--ui-font-sans`, `--ui-font-mono`; `--ui-text-page-*`, `--ui-text-section-*`, `--ui-text-body-*`, `--ui-text-label-*`, `--ui-text-caption-*` | Product typography hierarchy and code/identifier text. |
| Surfaces | `--ui-color-canvas`, `--ui-color-surface`, `--ui-color-surface-subtle` | Page and contained surfaces. |
| Text/borders | `--ui-color-text`, `--ui-color-muted`, `--ui-color-border`, `--ui-color-border-strong` | Default content and structural separation. |
| Primary | `--ui-color-primary`, `--ui-color-primary-hover`, `--ui-color-primary-subtle`, `--ui-color-primary-border` | Primary emphasis and selected/interactive state. |
| Semantic state | `--ui-color-success-*`, `--ui-color-warning-*`, `--ui-color-danger-*`, `--ui-color-info-*` | Actual semantic status/attention. Do not use danger/warning as decoration. |
| Focus | `--ui-focus-ring`, `--ui-color-focus-subtle` | Keyboard-visible focus and focus-related surfaces. |
| Spacing | `--ui-space-1`, `2`, `3`, `4`, `5`, `6`, `8` | Shared spacing scale. |
| Radius | `--ui-radius-sm`, `--ui-radius-md`, `--ui-radius-lg` | Shared corner radius scale. |
| Control/data size | `--ui-control-height-sm`, `--ui-control-height`, `--ui-control-height-lg`, `--ui-table-row-height` | Controls and tabular density. |
| Elevation | `--ui-shadow-overlay` | Overlay-level elevation only; avoid inventing additional decorative shadow systems. |

Changing a shared token is a cross-screen change. Review affected consumers and routed browser coverage rather than assuming a CSS-variable edit is local. See [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md) for the current two-generation style ownership model, root-layout import inventory, deprecation criteria and removal checklist. [`CONTRACT_COVERAGE.md`](CONTRACT_COVERAGE.md) records the exhaustive public-export and token-family coverage, including current motion/z-index gaps.

## Public primitive catalogue

The public top-level exports are defined by [`../../app/ui/index.ts`](../../app/ui/index.ts). Import through the public UI owner where practical instead of creating a parallel local primitive.

### `Button`

Source: [`../../app/ui/Button.tsx`](../../app/ui/Button.tsx).

Current API extends native `button` attributes and adds:

- `variant?: "primary" | "secondary" | "danger" | "ghost" | "icon" | "sm"`;
- `size?: "sm" | "lg"`.

Default `variant` is `secondary`. The component defaults `type` to `button`, so form submission must be requested explicitly with the native `type="submit"` attribute.

Use `primary` for the dominant safe action in a local context, `danger` for destructive intent, `secondary` for normal alternatives, and `ghost` for low-emphasis actions. Do not use color alone to communicate the meaning of a destructive or status-changing action.

### `IconButton`

Source: [`../../app/ui/IconButton.tsx`](../../app/ui/IconButton.tsx).

It extends native button attributes but requires an `aria-label`. The component also defaults `type` to `button`. An icon-only control without a meaningful accessible name is outside the design-system contract.

### `TextInput` and `Select`

Sources: [`../../app/ui/TextInput.tsx`](../../app/ui/TextInput.tsx) and [`../../app/ui/Select.tsx`](../../app/ui/Select.tsx).

Both preserve the corresponding native element attributes and add the shared visual classes. They do **not** create labels or error associations automatically. Use the shared form composition where label/help/error semantics are required; do not rely on placeholder text as the accessible label.

### `PageHeader`

Source: [`../../app/ui/PageHeader.tsx`](../../app/ui/PageHeader.tsx).

Current props:

- `title: ReactNode` — rendered as the page `h1`;
- `description?: ReactNode`;
- `actions?: ReactNode`;
- `children?: ReactNode` for additional header content;
- `className?: string`.

A product page should not add a second competing `h1` when `PageHeader` owns the page title.

### `Toolbar`

Source: [`../../app/ui/Toolbar.tsx`](../../app/ui/Toolbar.tsx).

`Toolbar` is currently a styled `div` accepting normal `HTMLAttributes<HTMLDivElement>`. It does not silently assign ARIA toolbar semantics. Add semantics only when the contained interaction model actually behaves as a toolbar.

### `Alert`

Source: [`../../app/ui/Alert.tsx`](../../app/ui/Alert.tsx).

`tone` uses the shared `StatusTone` set: `neutral`, `success`, `warning`, `danger`, `info`, `primary`. Default tone is `neutral`; default role is `status`. Override the role only when the message requires different announcement semantics.

### `StatusBadge`

Source: [`../../app/ui/StatusBadge.tsx`](../../app/ui/StatusBadge.tsx).

Current tones are `neutral`, `success`, `warning`, `danger`, `info`, `primary`. `badge?: boolean` switches to the design-system badge presentation. A badge/tone is presentation; status text must remain understandable without color alone.

### `Spinner`

Source: [`../../app/ui/Spinner.tsx`](../../app/ui/Spinner.tsx).

Current additions to native span attributes are `size?: number` and `label?: string`. Defaults are `18` and `"Загрузка…"`. The component renders `role="status"` with `aria-label`, so choose a more specific label when the loading scope is not obvious.

### `Skeleton`

Source: [`../../app/ui/Skeleton.tsx`](../../app/ui/Skeleton.tsx).

Current props add `variant?: "text" | "circle" | "rect"`, `width?` and `height?`. Default variant is `text`; skeletons are `aria-hidden="true"`. They are visual placeholders, not the only accessible indication that content is loading.

### Toasts

Source: [`../../app/ui/Toast.tsx`](../../app/ui/Toast.tsx).

The public contract exports `ToastProvider`, `useToast`, `ToastTone` and `ToastOptions`. Current tones are `success`, `error`, `warning`, `info`. `show()` accepts a message plus optional tone, action label/callback and duration. The viewport is a polite live region and individual toasts provide a labelled close button.

Do not put secrets, raw upstream bodies or sensitive identifiers into toast messages. Long-lived operational state should live in the owning screen/state model rather than only in a transient toast.

## Shared form compositions

The public forms surface is exported by [`../../app/ui/forms/index.ts`](../../app/ui/forms/index.ts):

- `Dialog` / `DialogProps` / `DialogSize`;
- `DialogFooter`;
- `FormErrorSummary` / `FormErrorItem`;
- `FormField`;
- `FormSection`.

Detailed current props, anatomy, focus/error behavior and do/don't guidance are documented in [`COMPOSITIONS.md`](COMPOSITIONS.md).

These are the preferred shared owners for dialog/form structure. Issue #96 owns product-flow integration of form/dialog patterns; #293 documents and governs the design-system contract and must not create a second destructive-confirmation mechanism.

## Shared data-list compositions

The public list surface is exported by [`../../app/ui/data-list/index.ts`](../../app/ui/data-list/index.ts):

- `DataListPage`;
- `DataListState` / `DataListStateKind`;
- `DataTable`;
- `Pagination`.

Detailed current props, state taxonomy, accessibility behavior and standard list composition are documented in [`COMPOSITIONS.md`](COMPOSITIONS.md).

Use this family before creating route-specific list/table/pagination primitives. Product adoption belongs to the owning screen issues; design-system documentation describes how to choose the shared owner.

## Usage rules

Prefer composition in this order:

1. Existing public primitive from `app/ui`.
2. Existing form or data-list composition.
3. Existing shell owner under `app/shell` when the concern is cross-route application chrome.
4. Route/domain component for behavior unique to that product area.
5. New shared primitive only when at least two consumers need the same semantic interaction and an existing primitive cannot represent it without distortion.

Do not introduce `shared/`, `common/`, `utils-ui/` or another generic component root beside `app/ui`. Do not copy a shared component into a feature folder to customize styling; extend the canonical primitive deliberately or compose it at the feature level.

## Accessibility contract

Shared UI changes must preserve native semantics and keyboard behavior. In particular:

- icon-only actions require an accessible name;
- page composition should maintain one clear `h1` owner;
- form controls require programmatic labels and errors where applicable;
- status/error meaning cannot depend on color alone;
- focus-visible behavior must remain visible;
- dialogs/forms/lists should use their shared composition owners before inventing local interaction semantics;
- loading placeholders must not remove an accessible loading/status indication;
- screenshots/examples must use sanitized fixture data and must not contain credentials, session material or production identities.

Issue #98 owns broader automated accessibility/visual-regression gates; this document is the usage contract, not a replacement for those tests.

## Change governance

When changing a token or shared primitive:

1. Identify the canonical source above and all affected consumers.
2. State the semantic reason for the change; visual preference alone is insufficient for a new primitive/token.
3. Preserve native/ARIA behavior unless the change explicitly fixes a tested accessibility defect.
4. Update component/source tests and routed browser coverage according to the current test policy.
5. Update this document when the public export, variant/tone set, accessibility contract or recommended composition changes.
6. Do not mix broad product-screen redesign with a design-system API change unless the migration is the explicit reviewed scope.

Deprecation requires an explicit replacement and migration path. Do not remove a public primitive merely because code search finds few consumers; framework discovery, tests and in-flight owner work must also be checked. Style-layer-specific migration/deprecation rules are in [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md).

## Showcase policy

`app/ShowcaseView.tsx` is retained as a **non-authoritative development/demo artifact**. It is not the source of truth for public component API, tokens, accessibility or production routing, and it must not be exposed as production UI or removed without a separately reviewed evidence-based change. Publication, sanitization, accessibility and removal rules are documented in [`SHOWCASE.md`](SHOWCASE.md).

## Verification and maintenance

For documentation-only changes, run the repository documentation consistency checks selected by current policy. When a change modifies `app/ui`, `app/styles`, shared form/list components or their public exports, validate the affected UI contracts and router-selected browser coverage in addition to documentation checks.

The exhaustive acceptance/coverage index is [`CONTRACT_COVERAGE.md`](CONTRACT_COVERAGE.md). It records public export coverage, the current absence of canonical motion/z-index token families, the new-primitive/custom-icon decision boundary and why semantic API truth remains code/test-owned rather than enforced through brittle prose assertions.

This documentation is living documentation. If a public UI API, token family, icon/brand contract or shared composition changes on `main`, the owning PR must update the affected design-system document or register a blocking documentation defect rather than leaving known stale guidance.

## #293 disposition

The independent documentation scope of #293 is covered by this entrypoint plus [`COMPOSITIONS.md`](COMPOSITIONS.md), [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md), [`SHOWCASE.md`](SHOWCASE.md) and [`CONTRACT_COVERAGE.md`](CONTRACT_COVERAGE.md). Semantic icon work #279 and brand work #291 remain separate product owners; when their contracts land on `main`, their owning PRs must update this living documentation if they change the documented design-system boundary.
