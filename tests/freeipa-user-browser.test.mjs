import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("user browser uses the shared FreeIPA action contract and exposes server query controls", () => {
  const component = fs.readFileSync(new URL("../app/FreeIpaUserBrowser.tsx", import.meta.url), "utf8");
  const events = fs.readFileSync(new URL("../freeipa-ui-events.ts", import.meta.url), "utf8");
  const wrapper = fs.readFileSync(new URL("../worker/freeipa-user-query-entry.ts", import.meta.url), "utf8");
  const bulkWrapper = fs.readFileSync(new URL("../worker/freeipa-user-bulk-entry.ts", import.meta.url), "utf8");
  const topWrapper = fs.readFileSync(new URL("../worker/freeipa-group-member-entry.ts", import.meta.url), "utf8");
  const serviceRoot = fs.readFileSync(new URL("../worker/service-admin-root-entry.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

  for (const value of ["q:", "status:", "group:", "sort:", "direction:", "page:", "pageSize:"]) {
    assert.equal(component.includes(value), true, value);
  }
  for (const value of ["openFreeIpaAction", "loadFreeIpaAccess", "FREEIPA_DIRECTORY_CHANGED_EVENT", "FreeIpaUserDetails", "Только просмотр", "Редактировать"]) {
    assert.equal(component.includes(value), true, value);
  }
  assert.doesNotMatch(component, /legacyUserButton|clickLegacyCreate|legacyCreateButton|lastFreeIpaToast/);
  assert.equal(component.includes("/api/integrations/freeipa/actions"), false);
  assert.equal(events.includes("FREEIPA_OPEN_ACTION_EVENT"), true);
  assert.equal(events.includes("/api/integrations/status"), true);
  assert.equal(wrapper.includes("normalizeFreeIpaUserQuery"), true);
  assert.equal(wrapper.includes("queryFreeIpaUsers"), true);
  assert.equal(bulkWrapper.includes("freeipa-user-query-entry"), true);
  assert.equal(topWrapper.includes("freeipa-user-bulk-entry"), true);
  assert.equal(topWrapper.includes("return bulkRuntime.fetch"), true);
  assert.equal(serviceRoot.includes('import rootRuntime from "./freeipa-group-member-entry"'), true);
  assert.equal(layout.includes("<FreeIpaUserBrowser />"), true);
  assert.equal(vite.includes("worker/service-admin-root-entry.ts"), true);
});
