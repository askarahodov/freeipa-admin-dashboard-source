# Product design system

This document is the canonical developer-facing entrypoint for the **Admin Dashboard Softrust** design system. It describes the UI contracts that exist on the current repository ref; it is not a proposal for a second component library.

Issue #293 owns the living documentation and governance of this surface. Runtime behavior, authorization and domain rules remain owned by their existing code/tests.

## Sources of truth

Use these sources in this order when documentation and implementation disagree:

1. [`../../app/ui/index.ts`](../../app/ui/index.ts) — public shared-primitive exports.
2. [`../../app/ui/forms/index.ts`](../../app/ui/forms/index.ts) — shared form/dialog exports.
3. [`../../app/ui/data-list/index.ts`](../../app/ui/data-list/index.ts) — shared list/table exports.
4. [`../../app/styles/tokens.css`](../../app/styles/tokens.css) — canonical design tokens.
5. Individual component implementations and their tests — exact props, semantics and behavior.
6. This document — usage guidance and governance.

Do not copy a class, token value or implementation detail from a historical design/spec document and treat it as a current API.

## Design direction

The product uses a **Calm Technical Workspace** model: functional density, restrained decoration, predictable hierarchy, semantic status colors, visible focus and reusable interaction patterns. Product screens should compose existing primitives before introducing route-specific visual language.

A design-system change must not move authorization, approval, validation or destructive-operation safety from the server into the browser.

## Canonical tokens

All shared tokens are defined under `:root` in [`../../app/styles/tokens.css`](../../app/styles/tokens.css). Consumers should use the semantic variables rather than copying their current literal values.

| Token family | Current canonical variables | Usage |
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

Changing a token is a cross-screen change. Review affected consumers and routed browser coverage rather than assuming a CSS-variable edit is local.

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

Deprecation requires an explicit replacement and migration path. Do not remove a public primitive merely because code search finds few consumers; framework discovery, tests and in-flight owner work must also be checked.

## Showcase policy

`app/ShowcaseView.tsx` is retained as a potential project-native interactive catalogue while #293 is open. It is **not** an independent source of truth: examples must follow the public exports, tokens and accessibility contract above. Do not build a second showcase/catalogue in parallel. A later #293 slice must explicitly choose reuse/update or removal with a canonical replacement.

## Verification and maintenance

For documentation-only changes, run the repository documentation consistency checks selected by current policy. When a change modifies `app/ui`, `app/styles`, shared form/list components or their public exports, validate the affected UI contracts and router-selected browser coverage in addition to documentation checks.

This document is living documentation. If a public UI API changes on `main`, the owning PR must update this file or register a blocking documentation defect rather than leaving known stale guidance.

## Remaining #293 scope

This foundation deliberately does not claim that #293 is complete. Remaining reviewable slices include:

- explicit legacy-style deprecation/replacement inventory;
- reconciliation with semantic icon work #279 and brand rules #291;
- explicit final decision and sanitised interactive coverage for `ShowcaseView`;
- CI guard improvements where a stable machine-checkable design-system contract is practical without brittle prose assertions.
