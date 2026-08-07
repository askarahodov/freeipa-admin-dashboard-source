# UI Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one canonical, accessible and dependency-light presentation foundation for Admin Dashboard Softrust without changing backend, API, RBAC, approval or runtime behavior.

**Architecture:** Add an additive CSS token layer plus small domain-agnostic React primitives under `app/ui/`. Existing feature CSS remains compatible during migration. One low-conflict UI surface proves integration; broad shell/navigation migration remains #94.

**Tech Stack:** React 19, TypeScript 5.9, Next/Vinext, CSS custom properties, Node 22 `node:test` source-contract tests.

## Global Constraints

- Target style is **Calm Technical Workspace**: hierarchy before decoration, border-first surfaces, restrained radii, compact readable density.
- One violet primary accent; semantic colors are used only for semantic state.
- Ordinary panels have no persistent shadow; elevation is reserved for overlays.
- Existing Geist CSS variables are consumed without editing `app/layout.tsx` while PR #90 owns that file.
- Do not edit `app/login/page.tsx`, branding strings, `.github/workflows/**`, documentation indexes/policies/source-of-truth files owned by parallel agents.
- Do not change API routes/payloads, authentication/session behavior, server-side RBAC, FreeIPA/XYOps execution, approvals/destructive confirmation, settings lifecycle or persistence behavior.
- Do not introduce a large third-party component framework or a new icon dependency in this slice.
- Foundation primitives must not import domain modules, call `fetch`, or own routing/business state.

---

## File map

- Create `app/styles/tokens.css`: canonical typography, color, spacing, radius, control, focus and elevation custom properties.
- Create `app/styles/primitives.css`: reusable styling contracts for controls, status surfaces, page headers and toolbars.
- Create `app/ui/Button.tsx`: native button wrapper with primary/secondary/danger/ghost variants.
- Create `app/ui/IconButton.tsx`: accessible square icon-only button requiring `aria-label`.
- Create `app/ui/TextInput.tsx`: domain-free native input wrapper.
- Create `app/ui/Select.tsx`: domain-free native select wrapper.
- Create `app/ui/StatusBadge.tsx`: semantic status badge with neutral/success/warning/danger/info/primary tones.
- Create `app/ui/Alert.tsx`: semantic feedback surface without error normalization/business logic.
- Create `app/ui/PageHeader.tsx`: title/description/actions layout primitive.
- Create `app/ui/Toolbar.tsx`: generic search/filter/action layout primitive.
- Create `app/ui/index.ts`: explicit public exports for the UI layer.
- Create `tests/ui-foundation.test.mjs`: source-contract tests for tokens, accessibility and domain isolation.
- Modify `app/globals.css`: import the new token/primitives layers and map legacy root variables/body typography to canonical tokens without mass rewriting feature selectors.
- Optionally modify one low-conflict existing component after active-PR ownership check to prove integration; omit if all safe candidates overlap concurrent work.

---

### Task 1: Lock the foundation contract with failing tests

**Files:**
- Create: `tests/ui-foundation.test.mjs`

**Interfaces:**
- Consumes: repository source files as text.
- Produces: source-level invariants that later foundation files must satisfy.

- [ ] **Step 1: Write the failing source-contract test**

Create a Node test that reads `app/styles/tokens.css`, `app/styles/primitives.css`, `app/ui/*.tsx` and `app/globals.css` and asserts:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("UI foundation exposes canonical semantic tokens", async () => {
  const css = await read("app/styles/tokens.css");
  for (const token of [
    "--ui-font-sans",
    "--ui-font-mono",
    "--ui-color-canvas",
    "--ui-color-surface",
    "--ui-color-text",
    "--ui-color-muted",
    "--ui-color-border",
    "--ui-color-primary",
    "--ui-color-danger",
    "--ui-focus-ring",
    "--ui-radius-sm",
    "--ui-radius-md",
    "--ui-radius-lg",
    "--ui-control-height",
    "--ui-shadow-overlay",
  ]) assert.match(css, new RegExp(token.replaceAll("-", "\\-")));
  assert.match(css, /--ui-radius-sm:\s*4px/);
  assert.match(css, /--ui-radius-md:\s*6px/);
  assert.match(css, /--ui-radius-lg:\s*8px/);
});

test("shared primitives remain domain agnostic and accessible", async () => {
  const files = ["Button", "IconButton", "TextInput", "Select", "StatusBadge", "Alert", "PageHeader", "Toolbar"];
  const sources = await Promise.all(files.map((name) => read(`app/ui/${name}.tsx`)));
  const all = sources.join("\n");
  for (const forbidden of ["fetch(", "FreeIPA", "XYOps", "localStorage", "sessionStorage", "/api/"]) {
    assert.equal(all.includes(forbidden), false, `domain coupling: ${forbidden}`);
  }
  const iconButton = await read("app/ui/IconButton.tsx");
  assert.match(iconButton, /aria-label/);
  const primitives = await read("app/styles/primitives.css");
  assert.match(primitives, /:focus-visible/);
});

test("global stylesheet consumes the canonical UI foundation", async () => {
  const globals = await read("app/globals.css");
  assert.match(globals, /@import\s+["']\.\/styles\/tokens\.css["']/);
  assert.match(globals, /@import\s+["']\.\/styles\/primitives\.css["']/);
  assert.match(globals, /font-family:\s*var\(--ui-font-sans\)/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/ui-foundation.test.mjs
```

Expected: FAIL because `app/styles/tokens.css` and the primitive files do not exist yet.

- [ ] **Step 3: Commit the RED contract**

```bash
git add tests/ui-foundation.test.mjs
git commit -m "test: define UI foundation contract"
```

---

### Task 2: Add canonical presentation tokens and global compatibility mapping

**Files:**
- Create: `app/styles/tokens.css`
- Create: `app/styles/primitives.css`
- Modify: `app/globals.css`
- Test: `tests/ui-foundation.test.mjs`

**Interfaces:**
- Produces CSS variables `--ui-*` consumed by all later primitives.
- Preserves legacy variables such as `--ink`, `--muted`, `--canvas`, `--line`, `--violet`, `--teal`, `--sidebar` as compatibility aliases where currently referenced.

- [ ] **Step 1: Implement `tokens.css` minimally**

Define `:root` tokens with these exact semantic categories and baseline values:

```css
:root {
  --ui-font-sans: var(--font-geist-sans), "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --ui-font-mono: var(--font-geist-mono), "SFMono-Regular", Consolas, monospace;

  --ui-color-canvas: #f7f7f9;
  --ui-color-surface: #ffffff;
  --ui-color-surface-subtle: #f3f4f6;
  --ui-color-text: #20222c;
  --ui-color-muted: #667085;
  --ui-color-border: #e4e5e9;
  --ui-color-border-strong: #cfd2d9;
  --ui-color-primary: #6d5bd0;
  --ui-color-primary-hover: #5c4ac0;
  --ui-color-primary-subtle: #f0edff;
  --ui-color-success: #177a52;
  --ui-color-success-subtle: #eaf7f0;
  --ui-color-warning: #9a6700;
  --ui-color-warning-subtle: #fff6d8;
  --ui-color-danger: #b42318;
  --ui-color-danger-subtle: #fff0ee;
  --ui-color-info: #175cd3;
  --ui-color-info-subtle: #eff4ff;
  --ui-focus-ring: #7f6ee8;

  --ui-space-1: 4px;
  --ui-space-2: 8px;
  --ui-space-3: 12px;
  --ui-space-4: 16px;
  --ui-space-5: 20px;
  --ui-space-6: 24px;
  --ui-space-8: 32px;

  --ui-radius-sm: 4px;
  --ui-radius-md: 6px;
  --ui-radius-lg: 8px;
  --ui-control-height-sm: 32px;
  --ui-control-height: 36px;
  --ui-control-height-lg: 40px;
  --ui-table-row-height: 44px;
  --ui-shadow-overlay: 0 12px 32px rgb(16 24 40 / 14%);

  --ui-text-page-size: 24px;
  --ui-text-page-line: 30px;
  --ui-text-section-size: 16px;
  --ui-text-section-line: 24px;
  --ui-text-body-size: 14px;
  --ui-text-body-line: 20px;
  --ui-text-label-size: 13px;
  --ui-text-label-line: 18px;
  --ui-text-caption-size: 12px;
  --ui-text-caption-line: 16px;
}
```

- [ ] **Step 2: Add primitive style contracts**

Implement `.ui-button`, `.ui-icon-button`, `.ui-input`, `.ui-select`, `.ui-status`, `.ui-alert`, `.ui-page-header`, `.ui-toolbar` plus variants. Every interactive primitive uses a shared `:focus-visible` rule with an outline/ring; normal surfaces use border and no default box shadow.

- [ ] **Step 3: Wire the foundation into `globals.css`**

Insert at the top:

```css
@import "./styles/tokens.css";
@import "./styles/primitives.css";
```

Map legacy root variables to canonical values instead of immediately replacing every feature selector:

```css
--ink: var(--ui-color-text);
--muted: var(--ui-color-muted);
--canvas: var(--ui-color-canvas);
--line: var(--ui-color-border);
--violet: var(--ui-color-primary);
```

Change only the `body` base font declaration to:

```css
font-family: var(--ui-font-sans);
```

Do not perform broad selector/radius/shadow changes in this task.

- [ ] **Step 4: Run the focused test**

```bash
node --experimental-strip-types --test tests/ui-foundation.test.mjs
```

Expected: token/global assertions pass; primitive-file assertions may still fail because React primitive files are not present.

- [ ] **Step 5: Commit tokens**

```bash
git add app/styles/tokens.css app/styles/primitives.css app/globals.css tests/ui-foundation.test.mjs
git commit -m "feat: add canonical UI design tokens"
```

---

### Task 3: Implement domain-agnostic React primitives

**Files:**
- Create: `app/ui/Button.tsx`
- Create: `app/ui/IconButton.tsx`
- Create: `app/ui/TextInput.tsx`
- Create: `app/ui/Select.tsx`
- Create: `app/ui/StatusBadge.tsx`
- Create: `app/ui/Alert.tsx`
- Create: `app/ui/PageHeader.tsx`
- Create: `app/ui/Toolbar.tsx`
- Create: `app/ui/index.ts`
- Test: `tests/ui-foundation.test.mjs`

**Interfaces:**
- `ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>` with `variant?: "primary" | "secondary" | "danger" | "ghost"`.
- `IconButtonProps` requires `"aria-label": string`.
- `TextInputProps extends React.InputHTMLAttributes<HTMLInputElement>`.
- `SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>`.
- `StatusBadgeProps` accepts `tone?: "neutral" | "success" | "warning" | "danger" | "info" | "primary"` and native span props.
- `AlertProps` accepts the same semantic tones except `primary` is optional; content is normal React children.
- `PageHeader` accepts `title`, optional `description`, optional `actions`, optional `children`.
- `Toolbar` forwards `HTMLAttributes<HTMLDivElement>`.

- [ ] **Step 1: Add `Button` and `IconButton`**

Use native `<button>` elements, merge class names without external helpers, preserve caller props, set `type="button"` only when no explicit type is provided, and require `aria-label` at the TypeScript interface for icon-only controls.

- [ ] **Step 2: Add form controls**

`TextInput` and `Select` forward refs/native props and append `ui-input` / `ui-select` classes. Invalid presentation derives from `aria-invalid="true"` in CSS rather than domain-specific validation state.

- [ ] **Step 3: Add semantic feedback primitives**

`StatusBadge` renders a `<span>` with `data-tone` and stable class `ui-status ui-status--<tone>`. `Alert` renders a `<div role="status">` by default and accepts an explicit native `role` override so callers can use `alert` for urgent feedback.

- [ ] **Step 4: Add layout primitives and public exports**

`PageHeader` renders a semantic header structure with title/description/actions slots. `Toolbar` is only a styled `<div>` composition boundary. Export all primitives explicitly from `app/ui/index.ts`.

- [ ] **Step 5: Run focused tests and lint**

```bash
node --experimental-strip-types --test tests/ui-foundation.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit primitives**

```bash
git add app/ui app/styles/primitives.css tests/ui-foundation.test.mjs
git commit -m "feat: add shared accessible UI primitives"
```

---

### Task 4: Prove integration on one low-conflict surface

**Files:**
- Inspect active PR changed-file lists immediately before editing.
- Modify one existing frontend component only if it is not owned by another active PR.
- Test: existing relevant source test plus `tests/ui-foundation.test.mjs`.

**Interfaces:**
- Consumer imports from `app/ui/index.ts` or focused primitive file.
- No data flow, API, RBAC, routing or mutation contract changes.

- [ ] **Step 1: Re-check active PR ownership**

Confirm #90/#91 and any newer frontend PRs. Do not select `app/layout.tsx`, `app/login/page.tsx`, CI files or documentation-agent files.

- [ ] **Step 2: Select the smallest safe consumer**

Preferred target order:

1. a standalone client enhancement component with a generic secondary/primary button;
2. a small settings subcomponent not being changed by #27 work;
3. otherwise skip visible integration and document that concurrent ownership prevented it.

- [ ] **Step 3: Replace presentation only**

Swap an existing generic button/status element for `Button`, `IconButton`, `StatusBadge`, `PageHeader` or `Toolbar` while preserving handlers, disabled conditions, ARIA names, text and data attributes.

- [ ] **Step 4: Run relevant tests**

```bash
node --experimental-strip-types --test tests/ui-foundation.test.mjs
npm run lint
npm run build
```

If the selected component has a dedicated `tests/*.test.mjs`, run it directly before the full build.

- [ ] **Step 5: Commit the integration slice**

```bash
git add app tests/ui-foundation.test.mjs
git commit -m "refactor: adopt shared UI primitive in safe surface"
```

If integration is skipped due to concurrent ownership, do not create an empty commit.

---

### Task 5: Verification and PR handoff

**Files:**
- Update PR #99 description/checklist only; do not modify documentation-agent owned files.

**Interfaces:**
- Produces a reviewable P0 foundation PR closing #93 when accepted.

- [ ] **Step 1: Run final verification**

```bash
node --experimental-strip-types --test tests/ui-foundation.test.mjs
npm run lint
npm run build
```

Then run repository `npm test` if the environment has the required runtime/dependencies; record any environment-only blocker explicitly rather than hiding it.

- [ ] **Step 2: Review diff for forbidden coupling**

Verify changed files contain no backend/API/security/CI changes, no new UI framework dependency, and no edits to #90/#91/docs-agent owned files beyond the already-approved design/plan artifacts.

- [ ] **Step 3: Update draft PR #99**

PR body must report:

- issue #93 / Epic #92;
- design decisions implemented;
- exact test commands/results;
- whether a real surface was migrated;
- documentation impact handoff for the documentation agent;
- explicit statement that backend/API/RBAC/approval behavior is unchanged.

- [ ] **Step 4: Keep PR draft until verification is green**

Only mark ready after final verification evidence exists. Do not merge over concurrent frontend work without checking current `main` and conflicts.
