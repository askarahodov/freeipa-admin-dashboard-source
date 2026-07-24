import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync(new URL("../app/LocalAdministrationContext.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/settings-tabs.css", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

const expectedTabs = ["general", "freeipa", "xyops", "access", "policies", "catalog", "diagnostics"];

test("settings expose all required administrative tabs", () => {
  for (const tab of expectedTabs) {
    assert.match(component, new RegExp(`id: \\"${tab}\\"`), tab);
  }
  for (const label of ["Общие", "FreeIPA", "XYOps", "Доступ", "Политики", "Каталог", "Диагностика"]) {
    assert.match(component, new RegExp(label), label);
  }
  assert.match(component, /data\.settingsTab = activeTab/);
  assert.match(component, /searchParams\.set\("tab", activeTab\)/);
});

test("existing settings sections are routed without replacing their forms", () => {
  assert.match(styles, /settings-page\[data-settings-tab\] > :not\(#local-administration-context\)/);
  assert.match(styles, /data-settings-tab="freeipa"[^}]+settings-grid/s);
  assert.match(styles, /data-settings-tab="freeipa"[^}]+settings-card:nth-child\(2\)/s);
  assert.match(styles, /data-settings-tab="xyops"[^}]+settings-card:nth-child\(1\)/s);
  assert.match(styles, /data-settings-tab="policies"[^}]+policy-editor/s);
  assert.match(styles, /data-settings-tab="catalog"[^}]+inspector-panel/s);
  assert.match(styles, /data-settings-tab="catalog"[^}]+contract-history/s);
  assert.match(styles, /data-settings-tab="catalog"[^}]+routes-panel/s);
  assert.doesNotMatch(component, /\/api\/integrations\/settings[^\n]+method:\s*"(?:PUT|POST)"/);
});

test("access and diagnostics tabs use existing protected pages", () => {
  for (const path of ["/access", "/sessions", "/audit", "/diagnostics"]) {
    assert.match(component, new RegExp(`href=\\"${path}\\"`), path);
  }
  assert.match(component, /fetch\("\/api\/auth\/diagnostics"/);
  assert.match(component, /sessionData\.user\?\.role === "admin"/);
  assert.match(component, /session\.user\?\.role !== "admin"/);
});

test("settings tab styles are loaded globally", () => {
  assert.match(layout, /import "\.\/settings-tabs\.css"/);
});
