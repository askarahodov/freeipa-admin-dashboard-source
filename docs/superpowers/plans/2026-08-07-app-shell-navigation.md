# AppShell and Product Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a domain-agnostic AppShell with stable grouped product navigation, local SVG icons and route-aware active state without changing current Home business logic or generated XYOps catalog navigation.

**Architecture:** Introduce independent shell units under `app/shell/` backed by the #93 UI tokens. The shell is controlled by caller props and contains no fetch/RBAC/domain state. `app/page.tsx` integration is deferred until a safe patch-capable workspace is available because connector writes replace whole files and parallel agents are active.

**Tech Stack:** React 19, TypeScript 5.9, CSS Modules, CSS custom properties from #93, Node 22 `node:test` source-contract tests.

## Global Constraints

- Product navigation is stable and does not contain generated XYOps categories.
- Do not add dead Integrations/Storage links until real routes exist.
- Primary navigation contains no Unicode glyph icons.
- Do not add a third-party icon dependency.
- SVG icons use `currentColor`, `aria-hidden="true"` and consistent 20px geometry.
- AppShell does not import FreeIPA, XYOps, API clients, permissions or business state.
- Caller owns RBAC visibility by passing visible item ids.
- `/automation/*` activates Catalog; `/` activates only Overview; trailing slashes are normalized.
- Navigation uses `<nav aria-label="Основная навигация">` and `aria-current="page"`.
- Narrow layout must not overlay content with fixed positioning.
- Do not edit `app/layout.tsx`, `app/login/page.tsx`, branding strings or documentation-agent-owned indexes/policies while PR #90 is active.
- Do not replace the entire `app/page.tsx` through connector writes.

---

### Task 1: Define shell source contracts first

**Files:**
- Create: `tests/app-shell.test.mjs`

**Interfaces:**
- Consumes source files under `app/shell/`.
- Produces invariants for navigation structure, route matching, icons and domain isolation.

- [ ] **Step 1: Write failing test**

The test must assert:

```js
const navigation = await read("app/shell/navigation.ts");
assert.match(navigation, /id:\s*"overview"[\s\S]*href:\s*"\/"/);
assert.match(navigation, /id:\s*"users"[\s\S]*href:\s*"\/users"/);
assert.match(navigation, /id:\s*"catalog"[\s\S]*href:\s*"\/automation"/);
assert.match(navigation, /id:\s*"diagnostics"[\s\S]*href:\s*"\/diagnostics"/);
assert.equal(navigation.includes("automationSections"), false);
assert.equal(/[⌂⌘♙♧◷✓≣⚙]/u.test(navigation), false);

const shell = await read("app/shell/AppShell.tsx");
assert.match(shell, /aria-label="Основная навигация"/);
assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
for (const forbidden of ["fetch(", "FreeIPA", "XYOps", "/api/", "permissions.includes"]) {
  assert.equal(shell.includes(forbidden), false);
}

const icons = await read("app/shell/ProductIcon.tsx");
assert.match(icons, /currentColor/);
assert.match(icons, /aria-hidden="true"/);

const css = await read("app/shell/app-shell.module.css");
assert.match(css, /@media \(max-width: 860px\)/);
assert.equal(/@media \(max-width: 860px\)[\s\S]*position:\s*fixed/.test(css), false);
```

Also assert route matching source includes explicit `/automation/` prefix handling and root equality handling.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test tests/app-shell.test.mjs
```

Expected: FAIL because `app/shell/navigation.ts` does not exist.

- [ ] **Step 3: Commit RED contract**

```bash
git add tests/app-shell.test.mjs
git commit -m "test: define AppShell navigation contract"
```

---

### Task 2: Implement typed stable navigation model

**Files:**
- Create: `app/shell/navigation.ts`
- Test: `tests/app-shell.test.mjs`

**Interfaces:**
- Produces `ProductNavItemId`, `ProductNavIconName`, `ProductNavItem`, `ProductNavGroup`, `PRODUCT_NAV_GROUPS`, `normalizeProductPath`, `isProductNavItemActive`.

- [ ] **Step 1: Define ids and groups**

Use exact item ids/hrefs:

- `overview` `/`
- `users` `/users`
- `groups` `/groups`
- `catalog` `/automation`
- `operations` `/operations`
- `approvals` `/approvals`
- `access` `/access`
- `sessions` `/sessions`
- `audit` `/audit`
- `diagnostics` `/diagnostics`
- `settings` `/settings`

Group ids: `overview`, `directory`, `automation`, `security`, `system`, `settings`.

- [ ] **Step 2: Implement path normalization/matching**

```ts
export function normalizeProductPath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] || "/";
  return clean === "/" ? "/" : clean.replace(/\/+$/, "") || "/";
}

export function isProductNavItemActive(item: ProductNavItem, currentPath: string): boolean {
  const path = normalizeProductPath(currentPath);
  if (item.id === "overview") return path === "/";
  if (item.id === "catalog") return path === "/automation" || path.startsWith("/automation/");
  return path === item.href;
}
```

- [ ] **Step 3: Run focused test**

Expected: navigation assertions pass; icon/shell assertions remain RED.

- [ ] **Step 4: Commit**

```bash
git add app/shell/navigation.ts tests/app-shell.test.mjs
git commit -m "feat: add stable product navigation model"
```

---

### Task 3: Implement local SVG product icon system

**Files:**
- Create: `app/shell/ProductIcon.tsx`
- Test: `tests/app-shell.test.mjs`

**Interfaces:**
- Consumes `ProductNavIconName`.
- Produces `ProductIcon({ name, className })`.

- [ ] **Step 1: Add typed icon component**

Create only the icons required by `PRODUCT_NAV_GROUPS`. Use one `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">` shell and path/circle/rect children per name. Keep stroke width consistent at `1.6`, line cap/joins round.

- [ ] **Step 2: Run focused test**

Expected: icon assertions pass; AppShell/CSS assertions remain RED.

- [ ] **Step 3: Commit**

```bash
git add app/shell/ProductIcon.tsx tests/app-shell.test.mjs
git commit -m "feat: add local product navigation icons"
```

---

### Task 4: Implement controlled AppShell and ProductSidebar

**Files:**
- Create: `app/shell/AppShell.tsx`
- Create: `app/shell/app-shell.module.css`
- Create: `app/shell/index.ts`
- Test: `tests/app-shell.test.mjs`

**Interfaces:**
- `AppShellProps`: `currentPath`, `visibleItemIds`, optional `badges`, `onNavigate`, `brand`, optional `systemStatus`, `header`, `children`.
- `onNavigate(item)` is the only navigation callback; shell never writes history itself.

- [ ] **Step 1: Render groups and visibility**

For each group, filter items against `visibleItemIds`; omit empty groups. Use button controls for the current integration model because `Home.navigateTo` owns history. Each button calls `onNavigate(item)`.

- [ ] **Step 2: Add accessibility contract**

- named `<nav>`;
- `aria-current` on active item;
- notification/badge is supplementary text;
- icon hidden from accessibility tree;
- group labels non-interactive.

- [ ] **Step 3: Add Calm Technical Workspace styles**

Desktop:
- 248px sidebar;
- solid `#171923`/token-compatible neutral background;
- no gradient and no box-shadow on active item;
- active item uses subtle violet tint and left indicator/border;
- compact spacing and group labels;
- main body min-width 0.

Narrow <=860px:
- one-column shell;
- sidebar `position: static`;
- groups wrap/scroll without covering content;
- no fixed overlay.

- [ ] **Step 4: Export shell API**

`app/shell/index.ts` exports AppShell, navigation types/data/helpers and ProductIcon.

- [ ] **Step 5: Run focused test**

```bash
node --experimental-strip-types --test tests/app-shell.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/shell tests/app-shell.test.mjs
git commit -m "feat: add controlled AppShell and product sidebar"
```

---

### Task 5: Verify isolation and open stacked draft PR

**Files:**
- No production changes required unless verification finds an issue.

- [ ] **Step 1: Compare against foundation branch**

Verify `agent/ui-design-system-foundation...agent/ui-app-shell` contains only #94 spec/plan/test/shell files and no `app/page.tsx` replacement.

- [ ] **Step 2: Open draft PR**

Base: `agent/ui-design-system-foundation`  
Head: `agent/ui-app-shell`

PR body must say this is phase 1 of #94 and intentionally does not close the issue until `Home` integration is safely applied.

- [ ] **Step 3: Use GitHub Actions as full verification**

Because local GitHub clone is unavailable in the execution sandbox, do not claim lint/build success until GitHub Actions report success for the stacked PR head.

- [ ] **Step 4: Integration follow-up**

Once a patch-capable workspace is available (or `app/page.tsx` ownership is safe), replace the legacy sidebar/topbar composition with AppShell using the existing `navigateTo`/popstate behavior. Only then add `Closes #94`.
