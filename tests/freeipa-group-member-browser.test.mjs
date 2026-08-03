import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("group member browser uses direct FreeIPA actions and the paginated API", () => {
  const component = fs.readFileSync(new URL("../app/FreeIpaGroupMemberBrowser.tsx", import.meta.url), "utf8");
  const events = fs.readFileSync(new URL("../freeipa-ui-events.ts", import.meta.url), "utf8");
  const wrapper = fs.readFileSync(new URL("../worker/freeipa-group-member-entry.ts", import.meta.url), "utf8");
  const selectiveRoot = fs.readFileSync(new URL("../worker/backup-selective-restore-root-entry.ts", import.meta.url), "utf8");
  const maintenanceControlRoot = fs.readFileSync(new URL("../worker/maintenance-control-root-entry.ts", import.meta.url), "utf8");
  const serviceRoot = fs.readFileSync(new URL("../worker/service-admin-root-entry.ts", import.meta.url), "utf8");
  const maintenanceGate = fs.readFileSync(new URL("../worker/maintenance-mode-root-entry.ts", import.meta.url), "utf8");
  const schemaRoot = fs.readFileSync(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

  for (const value of ["/api/integrations/groups/members", "status", "sort", "direction", "pageSize", "Без карточки", "openFreeIpaAction", "FREEIPA_DIRECTORY_CHANGED_EVENT", "loadFreeIpaAccess"]) {
    assert.equal(component.includes(value), true, value);
  }
  assert.doesNotMatch(component, /legacyRemove|lastFreeIpaToast/);
  assert.equal(component.includes("/api/integrations/freeipa/actions"), false);
  assert.equal(component.includes('className="danger-link"'), true);
  assert.equal(component.includes('data-portal-confirmation-control="1"'), true);
  assert.equal(events.includes("FREEIPA_OPEN_ACTION_EVENT"), true);
  assert.equal(wrapper.includes("/api/integrations/groups"), true);
  assert.equal(wrapper.includes("/api/integrations/users"), true);
  assert.equal(wrapper.includes("queryFreeIpaGroupMembers"), true);
  assert.equal(selectiveRoot.includes('import rootRuntime from "./freeipa-group-member-entry.ts"'), true);
  assert.equal(maintenanceControlRoot.includes('import rootRuntime from "./backup-selective-restore-root-entry.ts"'), true);
  assert.equal(serviceRoot.includes('import rootRuntime from "./maintenance-control-root-entry.ts"'), true);
  assert.equal(maintenanceGate.includes('import rootRuntime from "./service-admin-root-entry.ts"'), true);
  assert.equal(schemaRoot.includes('import rootRuntime from "./maintenance-mode-root-entry.ts"'), true);
  assert.equal(layout.includes("<FreeIpaGroupMemberBrowser />"), true);
  assert.equal(vite.includes('main: "./worker/schema-migrations-entry.ts"'), true);
});
