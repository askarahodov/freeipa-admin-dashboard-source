import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("product navigation has stable grouped destinations without generated catalog sections", async () => {
  const navigation = await read("app/shell/navigation.ts");
  for (const [id, href] of [["overview", "/"], ["users", "/users"], ["groups", "/groups"], ["catalog", "/automation"], ["operations", "/operations"], ["approvals", "/approvals"], ["access", "/access"], ["sessions", "/sessions"], ["audit", "/audit"], ["diagnostics", "/diagnostics"], ["settings", "/settings"]]) {
    assert.match(navigation, new RegExp(`id:\\s*"${id}"[\\s\\S]*href:\\s*"${href.replaceAll("/", "\\/")}"`));
  }
  assert.equal(navigation.includes("automationSections"), false);
  assert.equal(navigation.includes("/storage"), false);
  assert.equal(navigation.includes("/integrations"), false);
  assert.equal(/[⌂⌘♙♧◷✓≣⚙]/u.test(navigation), false);
});

test("route matching keeps root exact and product sections active on descendants", async () => {
  const navigation = await read("app/shell/navigation.ts");
  assert.match(navigation, /item\.id === "overview"[\s\S]*path === "\/"/);
  assert.match(navigation, /item\.id === "catalog"[\s\S]*path === "\/automation"[\s\S]*path\.startsWith\("\/automation\/"\)/);
  assert.match(navigation, /path === item\.href \|\| path\.startsWith\(`\$\{item\.href\}\/`\)/);
});

test("AppShell remains domain agnostic and exposes accessible product navigation", async () => {
  const shell = await read("app/shell/AppShell.tsx");
  assert.match(shell, /aria-label="Основная навигация"/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
  for (const forbidden of ["fetch(", "FreeIPA", "XYOps", "/api/", "permissions.includes"]) assert.equal(shell.includes(forbidden), false, `domain coupling: ${forbidden}`);
});

test("product icons are local SVGs with decorative accessibility semantics", async () => {
  const icons = await read("app/shell/ProductIcon.tsx");
  assert.match(icons, /currentColor/);
  assert.match(icons, /aria-hidden="true"/);
  assert.match(icons, /viewBox="0 0 20 20"/);
});

test("AppShell narrow layout never overlays product content", async () => {
  const css = await read("app/shell/app-shell.module.css");
  assert.match(css, /@media \(max-width: 860px\)/);
  const narrow = css.split("@media (max-width: 860px)")[1] ?? "";
  assert.equal(/position:\s*fixed/.test(narrow), false);
  assert.match(narrow, /position:\s*static/);
});
