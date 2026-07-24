import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync(new URL("../app/LocalAdministrationContext.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/settings-tabs.css", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

const expectedTabs = ["general", "freeipa", "xyops", "access", "policies", "catalog", "diagnostics"];

test("settings expose all required administrative tabs", () => {
  for (const tab of expectedTabs) {
    assert.equal(component.includes(`id: "${tab}"`), true, tab);
  }
  for (const label of ["Общие", "FreeIPA", "XYOps", "Доступ", "Политики", "Каталог", "Диагностика"]) {
    assert.equal(component.includes(label), true, label);
  }
  assert.equal(component.includes("page.dataset.settingsTab = activeTab;"), true);
  assert.equal(component.includes('url.searchParams.set("tab", activeTab);'), true);
});

test("existing settings sections are routed without replacing their forms", () => {
  for (const selector of [
    '.settings-page[data-settings-tab] > :not(#local-administration-context)',
    '.settings-page[data-settings-tab="freeipa"] > .settings-grid',
    '.settings-page[data-settings-tab="freeipa"] > .settings-grid > .settings-card:nth-child(2)',
    '.settings-page[data-settings-tab="xyops"] > .settings-grid > .settings-card:nth-child(1)',
    '.settings-page[data-settings-tab="policies"] > .policy-editor',
    '.settings-page[data-settings-tab="catalog"] > .inspector-panel',
    '.settings-page[data-settings-tab="catalog"] > .contract-history',
    '.settings-page[data-settings-tab="catalog"] > .routes-panel',
  ]) {
    assert.equal(styles.includes(selector), true, selector);
  }
  assert.equal(component.includes("/api/integrations/settings"), false);
});

test("access and diagnostics tabs use existing protected pages", () => {
  for (const path of ["/access", "/sessions", "/audit", "/diagnostics"]) {
    assert.equal(component.includes(`href="${path}"`), true, path);
  }
  assert.equal(component.includes('fetch("/api/auth/diagnostics"'), true);
  assert.equal(component.includes('sessionData.user?.role === "admin"'), true);
  assert.equal(component.includes('session.user?.role !== "admin"'), true);
});

test("settings tab styles are loaded globally", () => {
  assert.equal(layout.includes('import "./settings-tabs.css";'), true);
});
