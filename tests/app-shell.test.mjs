import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("product navigation has stable grouped destinations without generated catalog sections", async () => {
  const navigation = await read("app/shell/navigation.ts");
  assert.match(navigation, /id:\s*"overview"[\s\S]*href:\s*"\/"/);
  assert.match(navigation, /id:\s*"users"[\s\S]*href:\s*"\/users"/);
  assert.match(navigation, /id:\s*"groups"[\s\S]*href:\s*"\/groups"/);
  assert.match(navigation, /id:\s*"catalog"[\s\S]*href:\s*"\/automation"/);
  assert.match(navigation, /id:\s*"operations"[\s\S]*href:\s*"\/operations"/);
  assert.match(navigation, /id:\s*"approvals"[\s\S]*href:\s*"\/approvals"/);
  assert.match(navigation, /id:\s*"access"[\s\S]*href:\s*"\/access"/);
  assert.match(navigation, /id:\s*"sessions"[\s\S]*href:\s*"\/sessions"/);
  assert.match(navigation, /id:\s*"audit"[\s\S]*href:\s*"\/audit"/);
  assert.match(navigation, /id:\s*"diagnostics"[\s\S]*href:\s*"\/diagnostics"/);
  assert.match(navigation, /id:\s*"settings"[\s\S]*href:\s*"\/settings"/);
  assert.equal(navigation.includes("automationSections"), false);
  assert.equal(navigation.includes("/storage"), false);
  assert.equal(navigation.includes("/integrations"), false);
  assert.equal(/[⌂⌘♙♧◷✓≣⚙]/u.test(navigation), false);
});

test("route matching keeps root exact and treats catalog descendants as catalog", async () => {
  const navigation = await read("app/shell/navigation.ts");
  assert.match(navigation, /item\.id === "overview"[\s\S]*path === "\/"/);
  assert.match(navigation, /item\.id === "catalog"[\s\S]*path === "\/automation"[\s\S]*path\.startsWith\("\/automation\/"\)/);
  assert.match(navigation, /replace\(\/\\\/+\$\/,\s*""\)/);
});

test("AppShell remains domain agnostic and exposes accessible product navigation", async () => {
  const shell = await read("app/shell/AppShell.tsx");
  assert.match(shell, /aria-label="Основная навигация"/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
  for (const forbidden of ["fetch(", "FreeIPA", "XYOps", "/api/", "permissions.includes"]) {
    assert.equal(shell.includes(forbidden), false, `domain coupling: ${forbidden}`);
  }
});

test("product icons are local SVGs with decorative accessibility semantics", async () => {
  const icons = await read("app/shell/ProductIcon.tsx");
  assert.match(icons, /currentColor/);
  assert.match(icons, /aria-hidden="true"/);
  assert.match(icons, /viewBox="0 0 20 20"/);
  assert.equal(/[⌂⌘♙♧◷✓≣⚙]/u.test(icons), false);
});

test("AppShell narrow layout never overlays product content", async () => {
  const css = await read("app/shell/app-shell.module.css");
  assert.match(css, /@media \(max-width: 860px\)/);
  const narrow = css.split("@media (max-width: 860px)")[1] ?? "";
  assert.equal(/position:\s*fixed/.test(narrow), false);
  assert.match(narrow, /position:\s*static/);
});
