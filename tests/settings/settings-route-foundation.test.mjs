import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const indexPage = fs.readFileSync(new URL("../../app/settings/page.tsx", import.meta.url), "utf8");
const generalPage = fs.readFileSync(new URL("../../app/settings/general/page.tsx", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../../app/settings/SettingsRouteShell.tsx", import.meta.url), "utf8");

test("settings index redirects to the first canonical domain route", () => {
  assert.match(indexPage, /redirect\(["']\/settings\/general["']\)/u);
});

test("general settings uses authenticated lifecycle APIs without browser admin tokens", () => {
  assert.match(generalPage, /fetch\(path/u);
  assert.match(generalPage, /\/api\/auth\/session/u);
  assert.match(generalPage, /\/api\/integrations\/settings\/effective/u);
  assert.match(generalPage, /\/api\/integrations\/settings\/drafts/u);
  assert.match(generalPage, /\/validate/u);
  assert.match(generalPage, /\/apply/u);
  assert.match(generalPage, /settings\.manage/u);
  assert.doesNotMatch(generalPage, /ADMIN_TOKEN|x-admin-token|sessionStorage|localStorage/u);
});

test("general route is bounded to non-secret general configuration", () => {
  assert.match(generalPage, /demoMode/u);
  assert.doesNotMatch(generalPage, /ipaPassword|xyopsApiKey|ipaUrl|ipaUsername|xyopsUrl/u);
  assert.match(generalPage, /secret !== true/u);
});

test("settings route shell derives labels and paths from the canonical navigation model", () => {
  assert.match(shell, /settingsSections\.map/u);
  assert.match(shell, /aria-label="Разделы настроек"/u);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/u);
  assert.match(shell, /aria-disabled="true"/u);
});
