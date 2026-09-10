# Design-system contract coverage

This document maps the current public design-system surface to its documentation and verification owners. It exists to make #293 auditable without duplicating component source or adding brittle prose assertions to CI.

The authoritative API remains the current code/tests. This file is an index and coverage contract, not an alternative type definition.

## Public export coverage

The public shared UI surface is exported from [`../../app/ui/index.ts`](../../app/ui/index.ts). Every current top-level export is covered below.

| Public surface | Purpose / current states or variants | Accessibility / responsive contract | Detailed owner |
| --- | --- | --- | --- |
| `Alert` | semantic feedback with `neutral/success/warning/danger/info/primary` tones | current implementation owns role semantics; meaning must not depend on color | [`README.md`](README.md), `app/ui/Alert.tsx` |
| `Button` | primary/secondary/danger/ghost/icon/sm variants, sm/lg size support | native button semantics; keyboard/focus behavior preserved by shared styles | [`README.md`](README.md), `app/ui/Button.tsx` |
| `IconButton` | icon-only action | accessible name is required by the public props contract | [`README.md`](README.md), `app/ui/IconButton.tsx` |
| `PageHeader` | page title, description, actions and additional header content | owns the page `h1`; consumers must not create a competing page heading | [`README.md`](README.md), `app/ui/PageHeader.tsx` |
| `Select` | shared visual shell for native select behavior | native select semantics remain authoritative; labels/errors come from form composition | [`README.md`](README.md), `app/ui/Select.tsx` |
| `StatusBadge` | neutral/success/warning/danger/info/primary status presentation | text/meaning must remain understandable without color | [`README.md`](README.md), `app/ui/StatusBadge.tsx` |
| `TextInput` | shared visual shell for native text input behavior | native input semantics remain authoritative; labels/errors come from form composition | [`README.md`](README.md), `app/ui/TextInput.tsx` |
| `Toolbar` | shared toolbar-layout container | does not automatically assert ARIA toolbar semantics; consumer interaction model decides semantics | [`README.md`](README.md), `app/ui/Toolbar.tsx` |
| `Spinner` | bounded loading indicator with size/label options | current component exposes status semantics and an accessible label | [`README.md`](README.md), `app/ui/Spinner.tsx` |
| `Skeleton` | text/circle/rect visual loading placeholder | intentionally hidden from assistive technology; must not be the only loading indication | [`README.md`](README.md), `app/ui/Skeleton.tsx` |
| `ToastProvider` / `useToast` | success/error/warning/info transient notifications | polite live-region behavior belongs to implementation; sensitive data must not be rendered in messages | [`README.md`](README.md), `app/ui/Toast.tsx` |
| form exports | Dialog, DialogFooter, FormField, FormErrorSummary and FormSection | focus loop/return, labels, help/error association and semantic section hierarchy | [`COMPOSITIONS.md`](COMPOSITIONS.md), `app/ui/forms/index.ts` |
| data-list exports | DataListPage, DataListState, DataTable and Pagination | page heading ownership, state roles, labelled table region and pagination navigation | [`COMPOSITIONS.md`](COMPOSITIONS.md), `app/ui/data-list/index.ts` |

If `app/ui/index.ts`, `app/ui/forms/index.ts` or `app/ui/data-list/index.ts` gains or removes a public export, the owning change must update this matrix or record a blocking documentation defect.

## Token-family coverage

The modern shared primitive token owner is [`../../app/styles/tokens.css`](../../app/styles/tokens.css). The active compatibility/global `--ds-*` layer is documented separately in [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md).

| Requested token family | Current canonical shared coverage | Current rule |
| --- | --- | --- |
| typography | `--ui-font-*`, `--ui-text-*` | use semantic shared variables rather than literal typography values |
| spacing | `--ui-space-*` | use the shared spacing scale for reusable primitives/compositions |
| size | `--ui-control-height-*`, `--ui-table-row-height` | use shared control/data density values when the semantic role matches |
| radius | `--ui-radius-*` | use the shared radius scale rather than feature-specific shared radii |
| border | semantic `--ui-color-border*` variables | borders use semantic shared colors; compatibility selectors may still have active `--ds-*` ownership |
| elevation | `--ui-shadow-overlay` | only a shared overlay elevation is canonical today; do not invent a broad shadow scale without a reusable semantic need |
| color | canvas/surface/text/primary/success/warning/danger/info/focus variables | status colors represent semantics, not decoration |
| focus | `--ui-focus-ring`, `--ui-color-focus-subtle` plus shared focus-visible rules | keyboard-visible focus is mandatory |
| motion | **no canonical `--ui-*` motion token family exists on current main** | keep existing component-local timing unless a reviewed cross-component semantic motion contract is introduced; do not invent documentation-only tokens |
| z-index | **no canonical `--ui-*` z-index token family exists on current main** | preserve current component/global stacking behavior; introduce shared z-index tokens only with a verified cross-surface stacking model |

The absence of a canonical motion or z-index token family is a documented current-state gap, not permission to fabricate token names or values. If future design-system work introduces them, the same PR must define semantic roles, consumers, migration and tests.

## States, anatomy and responsive ownership

#293 requires developers and AI agents to choose the correct primitive/state/composition without copying route-specific CSS. The documentation model is therefore split deliberately:

- [`README.md`](README.md) describes top-level primitive purpose, public API/variants and baseline accessibility semantics;
- [`COMPOSITIONS.md`](COMPOSITIONS.md) describes form/dialog and data-list anatomy, state taxonomy, focus/error behavior and common admin-flow composition;
- [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md) describes token/style ownership, compatibility layers, deprecation and migration rules;
- [`SHOWCASE.md`](SHOWCASE.md) defines the retained non-authoritative showcase, sanitization, publication and removal policy.

Responsive behavior is not specified as a separate invented breakpoint API because current shared components do not expose such a public contract. Instead, changes to shared compositions must be verified on their consuming screens at the viewport set selected by the current test policy. Documentation must not claim responsive guarantees that the current code/tests do not provide.

## New primitive decision rule

A new shared primitive is justified only when all of these conditions are true:

1. at least two supported consumers need the same semantic interaction or presentation role;
2. existing public primitives/compositions cannot represent the behavior without distortion or duplicated semantics;
3. the new owner has a clear public API and accessibility contract;
4. the change includes focused tests and routed browser coverage appropriate to its risk;
5. token/style ownership is explicit and does not create a second generic component root;
6. migration guidance exists for any replaced pattern.

A local layout variation, one-off visual preference or similar appearance is not sufficient justification.

## Custom icon boundary

Icon semantics and cross-product icon normalization are owned by #279. The design-system documentation establishes the boundary but does not pre-empt that work:

- prefer the current canonical icon source used by shared/product UI;
- icon-only controls require an accessible name;
- an icon must not be the sole carrier of destructive/warning/status meaning;
- brand marks from #291 are not functional action/navigation icons;
- introduce a custom icon only when the canonical set cannot express the required semantic role and the new icon has a reviewable cross-product rationale.

When #279 or #291 changes current `main`, its owning PR must update the relevant design-system documentation if these contracts change.

## Deprecation and replacement coverage

Legacy/compatibility styles are not declared deprecated by age or filename. [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md) defines the required evidence: identified old owner, current replacement, known consumers, migration boundary, verification and removal conditions.

This satisfies the replacement/migration requirement without incorrectly labelling active `app/design-system.css` selectors or feature-owned styles as already obsolete.

## Examples and secret safety

The retained project-native `ShowcaseView` is governed by [`SHOWCASE.md`](SHOWCASE.md). It is non-authoritative and must not be exposed as production UI without an explicit reviewed publication change.

Any documentation, screenshot, fixture or interactive example used for design-system review must be synthetic and sanitized. Real identities, credentials, cookies, tokens, internal endpoints, private addresses and production data are prohibited.

Keyboard/accessibility claims belong to the actual component/consuming-flow tests. Markdown examples must not be used as evidence that an interactive flow is keyboard-correct.

## CI verification boundary

The repository already runs documentation consistency checks in Required CI. That layer is appropriate for deterministic documentation properties such as internal Markdown links and known structural contracts.

Semantic design-system truth remains with TypeScript/CSS implementations and their focused/browser tests. Do **not** add brittle CI assertions that compare prose sentences, exact Markdown tables or copied prop lists against source text.

A practical machine-checkable design-system guard is appropriate only when it validates a stable structural invariant—for example a canonical public-export boundary or a prohibited duplicate component root—without freezing documentation wording or implementation formatting.

For #293 itself, no additional prose-specific CI guard is required beyond the current documentation consistency gate and existing code/test owners. Future structural guards should be introduced only with a concrete regression they prevent.

## #293 acceptance map

| Acceptance criterion | Current evidence |
| --- | --- |
| each shared primitive has purpose, API/variants/states and accessibility contract | `README.md`, `COMPOSITIONS.md`, this exhaustive export matrix |
| identical visual roles use canonical tokens | `README.md` token catalogue + `STYLES_AND_MIGRATION.md`; compatibility exceptions are explicitly documented |
| a new screen can be composed without copying route-specific CSS | usage order and new-primitive rule in `README.md` / `COMPOSITIONS.md` |
| deprecated patterns have replacement and migration path | evidence-based deprecation/migration policy in `STYLES_AND_MIGRATION.md` |
| design-system changes require rationale and relevant tests/examples | governance sections in `README.md`, `COMPOSITIONS.md` and this document |
| documentation/examples are keyboard-safe and contain no PII/secrets | accessibility/sanitization contracts in `README.md`, `COMPOSITIONS.md`, `SHOWCASE.md`; interactive correctness remains test-owned |
| rules do not create a second component set | source hierarchy and explicit prohibition on parallel generic UI roots |
| relationship to #279/#291 is defined | icon/brand boundaries documented here and in `SHOWCASE.md` / `STYLES_AND_MIGRATION.md` |
| documentation is checked in CI where practical | existing Documentation consistency gate; semantic API truth remains code/test-owned |

After this matrix is merged, #293 has no remaining independent documentation implementation dependency on #279 or #291. Those issues remain owners of their future product changes, and their PRs must update this living documentation if they change the documented contract.
