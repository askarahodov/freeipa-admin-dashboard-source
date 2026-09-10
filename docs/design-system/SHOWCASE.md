# Showcase ownership and publication policy

This document defines the ownership and publication contract for `app/ShowcaseView.tsx`. It is deliberately conservative: the showcase may help developers inspect shared UI patterns, but it is **not** a source of truth for design-system API, accessibility, product behavior or production routing.

Issue #293 owns this documentation. Shared component behavior remains owned by the current public exports and implementations under `app/ui`, and token ownership remains documented in [`README.md`](README.md) and [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md).

## Current disposition

`app/ShowcaseView.tsx` is retained as a **non-authoritative development/demo surface**.

This means:

- do not treat its markup, inline styles, literal demo values or CSS classes as a stable public API;
- do not copy showcase-only markup into product screens as a shortcut around shared primitives;
- do not expose it as a production route merely because the component exists;
- do not delete it merely because ordinary reference search finds few or no consumers;
- before changing, publishing or removing it, verify current references, route ownership and active PRs on the exact target ref.

The current file demonstrates shared `Button`, `IconButton`, `TextInput`, `Select`, `StatusBadge`, `Spinner`, `Skeleton`, Toast and icon usage, along with examples of checkboxes/radios/toggles, table markup and empty-state presentation. Those examples are orientation material only; the canonical contracts remain the component implementations and design-system documentation.

## Source-of-truth precedence

When ShowcaseView disagrees with the current design system, use this precedence:

1. public exports in `app/ui/index.ts`, `app/ui/forms/index.ts` and `app/ui/data-list/index.ts`;
2. current component implementations and their tests;
3. modern token owner `app/styles/tokens.css` plus the active compatibility/global boundary documented in [`STYLES_AND_MIGRATION.md`](STYLES_AND_MIGRATION.md);
4. [`README.md`](README.md) and [`COMPOSITIONS.md`](COMPOSITIONS.md);
5. `app/ShowcaseView.tsx` examples.

A showcase mismatch is a documentation/demo defect. Do not add compatibility behavior to a shared component solely to preserve an outdated showcase example.

## Allowed use

The retained showcase may be used for local development and review of existing shared UI patterns when all of these rules are followed:

- examples use existing public primitives or clearly labelled raw/native controls;
- example data is synthetic and contains no real identities, credentials, hostnames, internal URLs or production values;
- semantic status examples remain understandable without color alone;
- icon-only controls have accessible names;
- examples do not imply server authorization, RBAC, approval or destructive-operation guarantees that a visual primitive cannot provide;
- screenshots or recordings derived from the showcase use sanitized deterministic data.

Do not use the showcase as a substitute for routed browser tests on real consuming screens.

## Publication as an interactive route

Making the showcase reachable through an application route is a separate product/developer-experience change, not an automatic consequence of retaining the component.

Before publication, the owning PR must explicitly define:

1. route and environment availability, including whether the route exists only in development/test builds;
2. access control and whether the route is excluded from production navigation;
3. fixture ownership and sanitization rules;
4. accessibility expectations for keyboard, focus, headings, labels, live regions and contrast;
5. responsive coverage for the supported viewport set;
6. visual-regression or screenshot policy where applicable;
7. whether raw compatibility-layer examples remain necessary or should be represented through canonical shared components;
8. rollback/removal behavior.

A public route must not reveal environment variables, session state, upstream data, internal endpoints or live administrative objects.

## Fixture and secret-safety contract

Showcase examples must use deterministic synthetic values. In particular, never include:

- real FreeIPA usernames, group names, emails or directory records;
- real XYOps event/process identifiers or API keys;
- `ADMIN_TOKEN`, `CONFIG_ENCRYPTION_KEY`, cookies, Authorization headers or bearer tokens;
- internal DNS names, production URLs, private IP addresses or certificate material;
- copied production error bodies or logs.

Password/token-like examples should be obviously synthetic placeholders and must not resemble reusable credentials from any environment.

## Accessibility rules

Showcase examples should model the intended accessible usage of a primitive, not only its visual state.

At minimum:

- icon-only actions require an accessible name;
- form controls need visible/programmatic labels when the example represents recommended usage;
- error/success/warning meaning cannot rely on color alone;
- loading examples must include an accessible status when the underlying primitive does not provide one itself;
- examples should preserve a logical heading hierarchy;
- interactive examples must remain keyboard operable.

If an example intentionally demonstrates an anti-pattern, label it explicitly as a negative example so it cannot be mistaken for recommended usage.

## Relationship to #279 and #291

Issue #279 owns semantic product language, colors, icons and affordance consistency. When #279 changes current design-system semantics, ShowcaseView may be updated in the same or a follow-up bounded PR, but #293 documentation does not pre-empt those visual decisions.

Issue #291 owns logo and brand identity. Brand marks must not be introduced into the showcase as functional action/navigation icons. Any future brand showcase section must follow the approved #291 usage/licensing contract and use sanitized assets.

## Relationship to forms and lists

The preferred form/dialog and data-list patterns are documented in [`COMPOSITIONS.md`](COMPOSITIONS.md). A future showcase section for those patterns should render the actual shared compositions rather than rebuilding lookalike forms, dialogs, table regions or pagination with raw markup.

Raw/native examples are acceptable only when their purpose is explicit and they do not imply that the raw form is the preferred product pattern.

## Removal criteria

`ShowcaseView.tsx` may be removed when all of the following have been checked on the exact merge candidate:

1. no supported route, framework convention, test, fixture or documentation depends on it;
2. no active PR/workstream owns it or expects it as review evidence;
3. its useful design-system examples are represented by current documentation/tests or an approved replacement catalogue;
4. removal does not alter production routing, build behavior or shared CSS reachability unexpectedly;
5. relevant documentation links and references are updated in the same change.

Do not infer safe removal from filename, age, lack of ordinary imports, or an incomplete code-search result alone.

## Maintenance

When `ShowcaseView.tsx` changes materially, review whether this policy or the canonical design-system docs need an update. When shared public APIs change, update the showcase only after the canonical owner and tests are correct.

The current decision for #293 is therefore explicit: **retain ShowcaseView as a non-authoritative development/demo artifact; do not publish it as production UI or remove it without a separately reviewed, evidence-based change.**
