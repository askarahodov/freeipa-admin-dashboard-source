import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const indexPage = fs.readFileSync(new URL("../../app/settings/page.tsx", import.meta.url), "utf8");
const generalPage = fs.readFileSync(new URL("../../app/settings/general/page.tsx", import.meta.url), "utf8");
const integrationsPage = fs.readFileSync(new URL("../../app/settings/integrations/page.tsx", import.meta.url), "utf8");
const lifecycleClient = fs.readFileSync(new URL("../../app/settings/settings-lifecycle-client.ts", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../../app/settings/SettingsRouteShell.tsx", import.meta.url), "utf8");

test("settings index redirects to the first canonical domain route", () => {
  assert.match(indexPage, /redirect\(["']\/settings\/general["']\)/u);
});

test("settings domain routes share authenticated lifecycle APIs without browser admin tokens", () => {
  for (const source of [generalPage, integrationsPage]) {
    assert.match(source, /settings-lifecycle-client/u);
    assert.doesNotMatch(source, /ADMIN_TOKEN|x-admin-token|sessionStorage|localStorage/u);
  }
  assert.match(lifecycleClient, /fetch\(path/u);
  assert.match(lifecycleClient, /\/api\/auth\/session/u);
  assert.match(lifecycleClient, /\/api\/integrations\/settings\/effective/u);
  assert.match(lifecycleClient, /\/api\/integrations\/settings\/drafts/u);
  assert.match(lifecycleClient, /\/validate/u);
  assert.match(lifecycleClient, /\/apply/u);
  assert.doesNotMatch(lifecycleClient, /ADMIN_TOKEN|x-admin-token|sessionStorage|localStorage/u);
});

test("general route remains bounded to non-secret general configuration", () => {
  assert.match(generalPage, /demoMode/u);
  assert.doesNotMatch(generalPage, /ipaPassword|xyopsApiKey|ipaUrl|ipaUsername|xyopsUrl/u);
  assert.match(generalPage, /secret !== true/u);
});

test("integrations route owns connection fields and never restores secrets from effective settings", () => {
  for (const field of ["ipaUrl", "ipaUsername", "ipaPassword", "xyopsUrl", "xyopsApiKey"]) {
    assert.match(integrationsPage, new RegExp(field, "u"));
  }
  assert.match(integrationsPage, /ipaPassword: ""/u);
  assert.match(integrationsPage, /xyopsApiKey: ""/u);
  assert.match(integrationsPage, /type="password"/u);
  assert.match(integrationsPage, /autoComplete="new-password"/u);
  assert.match(integrationsPage, /beforeunload/u);
  assert.match(integrationsPage, /hasUnsavedChanges=\{dirty && !draft\}/u);
});

test("settings route shell exposes only implemented routes and guards dirty navigation", () => {
  assert.match(shell, /new Set\(\["general", "integrations"\]\)/u);
  assert.match(shell, /settingsSections\.map/u);
  assert.match(shell, /aria-label="Разделы настроек"/u);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/u);
  assert.match(shell, /aria-disabled="true"/u);
  assert.match(shell, /window\.confirm/u);
  assert.match(shell, /event\.preventDefault/u);
});
