# Form, dialog and data-list compositions

This document extends the [design-system entrypoint](README.md) with the current public composition contracts under `app/ui/forms` and `app/ui/data-list`. It documents what the code on the current ref provides; it does not create a second form, confirmation, list or pagination implementation.

Issue #293 owns this documentation. Product-flow adoption remains with the owning UI issues, especially #96 for form/dialog integration. Server authorization, approval and destructive-operation policy remain server-owned.

## Source-of-truth rule

Exact public exports are defined by:

- [`../../app/ui/forms/index.ts`](../../app/ui/forms/index.ts);
- [`../../app/ui/data-list/index.ts`](../../app/ui/data-list/index.ts).

Exact behavior and props remain owned by the component implementations and tests linked below. If this document disagrees with current code/tests, fix the document rather than adding compatibility behavior to match stale prose.

## Forms and dialogs

### `Dialog`

Source: [`../../app/ui/forms/Dialog.tsx`](../../app/ui/forms/Dialog.tsx).

#### Current API

`DialogSize` is `"sm" | "md" | "lg"`.

`DialogProps` currently contains:

| Prop | Required | Current meaning |
| --- | --- | --- |
| `open: boolean` | yes | Controls whether the dialog is rendered. |
| `title: ReactNode` | yes | Dialog heading; connected to `aria-labelledby`. |
| `children: ReactNode` | yes | Dialog body content. |
| `onClose: () => void` | yes | Close callback used by supported close interactions. |
| `description?: ReactNode` | no | Optional description connected through `aria-describedby`. |
| `footer?: ReactNode` | no | Optional footer frame. Prefer `DialogFooter` for shared action layout. |
| `size?: DialogSize` | no | Defaults to `md`. |
| `closeLabel?: string` | no | Accessible name for the close button; defaults to `Закрыть`. |
| `closeOnEscape?: boolean` | no | Defaults to `true`. |
| `closeOnBackdrop?: boolean` | no | Defaults to `true`. |
| `initialFocusRef?: RefObject<HTMLElement \| null>` | no | Preferred initial focus target when the dialog opens. |

#### Accessibility and lifecycle

The current implementation renders `role="dialog"`, `aria-modal="true"`, generated title/description relationships, a labelled icon close button, Escape handling, a Tab/Shift+Tab focus loop and focus restoration to the element active before opening. While open it prevents body scrolling and restores the previous overflow value on cleanup.

If a workflow must not close on Escape or backdrop—for example because the user would silently lose an important in-progress action—set the corresponding prop explicitly and provide a clear visible exit path. Do not remove the focus loop or focus restoration merely to simplify a feature-specific dialog.

#### Do / don't

**Do:** put the semantic heading in `title`, use `description` for concise context, place actual form content in `children`, and use `DialogFooter` for separated danger and normal action areas.

**Don't:** create a second generic modal wrapper in a feature folder, make a clickable `div` act as the only close control, or bypass the existing destructive confirmation contract from `PortalInteractionLayer` just because the visual dialog shell is reusable.

### `DialogFooter`

Source: [`../../app/ui/forms/DialogFooter.tsx`](../../app/ui/forms/DialogFooter.tsx).

Current props are:

- `actions: ReactNode` — required normal action area;
- `danger?: ReactNode` — optional visually separated danger area;
- `className?: string`.

Use `danger` to keep destructive controls structurally separate from ordinary cancel/save actions. The component is layout only; it does not authorize or confirm destructive mutations.

### `FormField`

Source: [`../../app/ui/forms/FormField.tsx`](../../app/ui/forms/FormField.tsx).

#### Current API

| Prop | Required | Current meaning |
| --- | --- | --- |
| `id: string` | yes | Stable control id and label target. |
| `label: string` | yes | Visible field label. |
| `children: ReactElement` | yes | Control cloned with the field accessibility state. |
| `helpText?: string` | no | Help paragraph added to `aria-describedby`. |
| `error?: string` | no | Error paragraph added to `aria-describedby`; also sets `aria-invalid`. |
| `required?: boolean` | no | Participates in resolved required state. Defaults to `false`. |
| `optional?: boolean` | no | Requests explicit optional presentation when the field is not required. |
| `className?: string` | no | Additional field wrapper class. |

The component connects `label[for]` to the cloned child `id`, composes existing `aria-describedby` with generated help/error ids, and propagates `required`/`aria-invalid` rather than requiring every feature form to recreate those relationships.

A child control may already be `required`; `FormField` resolves that state with the wrapper props through the existing `form-field-state` owner. Do not manually duplicate “required” text beside a `FormField` and create conflicting semantics.

#### Do / don't

**Do:** use a stable `id`, keep concise help text separate from validation errors, and pass the real input/select/textarea as the child.

**Don't:** use placeholder text as the only label, render an error visually without associating it with the field, or generate unstable ids from display text when persisted links/focus targets depend on them.

### `FormErrorSummary`

Source: [`../../app/ui/forms/FormErrorSummary.tsx`](../../app/ui/forms/FormErrorSummary.tsx).

`FormErrorItem` contains `message: string` and optional `fieldId?: string`. `FormErrorSummaryProps` contains `errors: FormErrorItem[]` and optional `title?: string`, defaulting to `Проверьте форму`.

The component renders nothing when `errors` is empty. When errors exist, the summary uses `role="alert"`; an item with `fieldId` becomes a link to that control id. Use `fieldId` whenever the user can act on a specific field so the summary helps navigation instead of only repeating text.

The summary complements field-level errors; it is not a reason to remove the local error association from `FormField`.

### `FormSection`

Source: [`../../app/ui/forms/FormSection.tsx`](../../app/ui/forms/FormSection.tsx).

`FormSectionProps` extends section element attributes (except the native `title` attribute) and requires `title: ReactNode`; `description?: ReactNode` is optional. The current implementation renders a semantic `<section>`, an `h3` heading, optional description and the section body.

Use it to group meaningful subsections such as Basic, Membership or Advanced when the form is large enough to benefit from hierarchy. Do not wrap every pair of fields in a section or create heading-level jumps that conflict with the surrounding page/dialog structure.

## Data-list compositions

### `DataListPage`

Source: [`../../app/ui/data-list/DataListPage.tsx`](../../app/ui/data-list/DataListPage.tsx).

Current props:

- `title: ReactNode` — required and passed to `PageHeader`, therefore owns the page `h1`;
- `children: ReactNode` — required list/table body;
- `description?: ReactNode`;
- `actions?: ReactNode`;
- `toolbar?: ReactNode`;
- `footer?: ReactNode`;
- `className?: string`.

Composition order is PageHeader → optional toolbar → body → optional footer. Use this owner for a standard list screen instead of rebuilding page-header/table/footer spacing per route.

Do not add a second page-level `h1` inside `children` when `DataListPage.title` already owns the heading.

### `DataListState`

Source: [`../../app/ui/data-list/DataListState.tsx`](../../app/ui/data-list/DataListState.tsx).

`DataListStateKind` is:

- `loading`;
- `empty`;
- `filtered-empty`;
- `error`;
- `forbidden`.

Current props are `kind`, `title`, optional `description` and optional `action`.

`error` maps to a danger `Alert` with `role="alert"`; `forbidden` maps to warning; other current states use neutral presentation and `role="status"`. This mapping is the present shared contract. A feature should choose the semantic state that actually occurred rather than using warning/danger to make an empty screen visually prominent.

Distinguish `empty` from `filtered-empty`: the first means there is no data for the underlying collection; the second means the current filter/search yields no visible matches. The recovery action and wording should reflect that distinction.

### `DataTable`

Source: [`../../app/ui/data-list/DataTable.tsx`](../../app/ui/data-list/DataTable.tsx).

`DataTableProps` extends native table attributes and requires `label: string`. The implementation places the table inside a focusable `role="region"` with `aria-label={label}` and applies the canonical table styling.

Use a specific label such as the entity set or purpose, not a generic “Таблица”. Keep native table structure (`thead`, `tbody`, headers/cells) inside the component; do not replace it with a visually similar div grid unless the interaction truly is not tabular.

### `Pagination`

Source: [`../../app/ui/data-list/Pagination.tsx`](../../app/ui/data-list/Pagination.tsx).

Current props:

| Prop | Required | Current meaning |
| --- | --- | --- |
| `page: number` | yes | Current page input. Display is clamped to the valid visible range. |
| `totalPages: number` | yes | Total page count; visible minimum is one page. |
| `onPrevious: () => void` | yes | Previous-page callback. |
| `onNext: () => void` | yes | Next-page callback. |
| `totalItems?: number` | no | When supplied, displayed using `ru-RU` number formatting. |
| `disabled?: boolean` | no | Disables both navigation directions; defaults to `false`. |

The component renders a `nav` labelled `Пагинация`, a polite live summary and shared secondary Buttons. Previous/next controls are disabled automatically at boundaries in addition to the explicit disabled state.

Keep page/data ownership in the feature or query model. `Pagination` does not fetch data, mutate URL state or infer server cursors.

## Common admin compositions

### List/search screen

Preferred structure:

1. `DataListPage` owns title/description/page actions.
2. Search/filter controls live in its `toolbar` region.
3. `DataListState` handles loading, empty, filtered-empty, forbidden and error states.
4. `DataTable` renders the successful tabular result.
5. `Pagination` lives in the footer when page navigation is needed.

Do not render “0 results” with the same UI as an upstream/server error; those states have different recovery paths.

### Create/edit form

Preferred structure:

1. real `<form>` owns submit semantics;
2. `FormSection` groups meaningful areas when needed;
3. each field uses `FormField` for label/help/error association;
4. `FormErrorSummary` provides form-level navigation when multiple errors exist;
5. submit/cancel controls use shared `Button` semantics;
6. a modal form uses `Dialog` + `DialogFooter` without inventing another modal/focus implementation.

Do not silently persist password/token fields in browser draft storage. Product-specific unsaved/conflict recovery belongs to the owning flow and its security contract.

### Destructive action

`Dialog` and `DialogFooter` are presentation/composition primitives, not a replacement for the existing destructive-operation safety contract. Reuse the product confirmation flow owned by `PortalInteractionLayer` and the server-side authorization/audit path. Do not create a feature-local confirmation mechanism with weaker semantics.

## Responsive and keyboard review

A shared composition change should be reviewed at the level of the surfaces that consume it. At minimum verify, as applicable:

- keyboard entry, Tab/Shift+Tab order and visible focus;
- Escape/backdrop rules for dialogs;
- focus return after close;
- error-summary links target valid field ids and navigate to those anchors;
- table region remains operable when content overflows horizontally;
- pagination controls expose disabled boundaries correctly;
- narrow-screen action/footer layout does not hide the primary or recovery action;
- loading/empty/error wording remains available without relying on color or animation.

Use current routed browser tests for consuming flows; do not claim responsive/keyboard correctness from Markdown review alone.

## Governance

Public composition changes require all of the following:

1. semantic rationale and identified consumers;
2. current API/types updated at the canonical component owner;
3. focused component/source tests plus router-selected browser coverage where behavior changes;
4. this document updated when public props, state taxonomy, accessibility behavior or recommended composition changes;
5. explicit migration guidance when an existing public pattern is deprecated.

Do not add a new shared form/list abstraction merely because one feature needs a local layout variation. Prefer composing the existing public owners; promote a new primitive only when the semantic behavior is reusable and reviewable across multiple consumers.
