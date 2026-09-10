import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSettingsPath,
  resolveLegacySettingsRedirect,
  resolveLegacySettingsTab,
  resolveSettingsSection,
  settingsSections,
} from "../../app/settings/settings-navigation.ts";

const expectedSections = [
  ["general", "/settings/general"],
  ["integrations", "/settings/integrations"],
  ["catalog", "/settings/catalog"],
  ["visibility", "/settings/visibility"],
  ["approvals", "/settings/approvals"],
  ["presentation", "/settings/presentation"],
  ["access", "/settings/access"],
  ["diagnostics", "/settings/diagnostics"],
  ["advanced", "/settings/advanced"],
];

test("settings navigation exposes the complete canonical route set", () => {
  assert.deepEqual(
    settingsSections.map(({ id, path }) => [id, path]),
    expectedSections,
  );
  assert.equal(new Set(settingsSections.map(({ id }) => id)).size, settingsSections.length);
  assert.equal(new Set(settingsSections.map(({ path }) => path)).size, settingsSections.length);
});

test("canonical settings routes round-trip through the resolver", () => {
  for (const [id, path] of expectedSections) {
    assert.equal(buildSettingsPath(id), path);
    assert.equal(resolveSettingsSection(path), id);
    assert.equal(resolveSettingsSection(`${path}/`), id);
  }
  assert.equal(resolveSettingsSection("/settings"), null);
  assert.equal(resolveSettingsSection("/settings/unknown"), null);
});

test("legacy tab links resolve deterministically without accepting unknown tabs", () => {
  for (const [id, path] of expectedSections) {
    assert.equal(resolveLegacySettingsTab(id), id);
    assert.equal(resolveLegacySettingsRedirect(id), path);
  }

  assert.equal(resolveLegacySettingsTab("  GENERAL  "), "general");
  assert.equal(resolveLegacySettingsTab("freeipa"), "integrations");
  assert.equal(resolveLegacySettingsRedirect("freeipa"), "/settings/integrations");
  assert.equal(resolveLegacySettingsTab("xyops"), "integrations");
  assert.equal(resolveLegacySettingsRedirect("xyops"), "/settings/integrations");
  assert.equal(resolveLegacySettingsTab("policies"), "visibility");
  assert.equal(resolveLegacySettingsRedirect("policies"), "/settings/visibility");

  for (const unknown of ["unknown", "constructor", "__proto__", "toString"]) {
    assert.equal(resolveLegacySettingsTab(unknown), null);
    assert.equal(resolveLegacySettingsRedirect(unknown), "/settings/general");
  }

  assert.equal(resolveLegacySettingsTab(null), null);
  assert.equal(resolveLegacySettingsRedirect(null), "/settings/general");
});
