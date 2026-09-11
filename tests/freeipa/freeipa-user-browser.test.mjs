import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("user browser uses the shared FreeIPA action contract and exposes server query controls", () => {
  const component = fs.readFileSync(new URL("../../app/directory/FreeIpaUserBrowser.tsx", import.meta.url), "utf8");
  const events = fs.readFileSync(new URL("../../src/freeipa/freeipa-ui-events.ts", import.meta.url), "utf8");
  const wrapper = fs.readFileSync(new URL("../../worker/freeipa-user-query-entry.ts", import.meta.url), "utf8");
  const bulkWrapper = fs.readFileSync(new URL("../../worker/freeipa-user-bulk-entry.ts", import.meta.url), "utf8");
  const topWrapper = fs.readFileSync(new URL("../../worker/freeipa-group-member-entry.ts", import.meta.url), "utf8");
  const selectiveRoot = fs.readFileSync(new URL("../../worker/backup-selective-restore-root-entry.ts", import.meta.url), "utf8");
  const maintenanceControlRoot = fs.readFileSync(new URL("../../worker/maintenance-control-root-entry.ts", import.meta.url), "utf8");
  const serviceAdminGate = fs.readFileSync(new URL("../../worker/middleware/service-admin-authentication.ts", import.meta.url), "utf8");
  const maintenanceGate = fs.readFileSync(new URL("../../worker/maintenance-mode-gate.ts", import.meta.url), "utf8");
  const securityComposition = fs.readFileSync(new URL("../../worker/security-composition.ts", import.meta.url), "utf8");
  const application = fs.readFileSync(new URL("../../worker/application.ts", import.meta.url), "utf8");
  const schemaRoot = fs.readFileSync(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
  const httpSecurityRoot = fs.readFileSync(new URL("../../worker/http-security-root-entry.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

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
  assert.equal(selectiveRoot.includes('import rootRuntime from "./freeipa-group-member-entry.ts"'), true);
  assert.equal(selectiveRoot.includes("return rootRuntime.fetch"), true);
  assert.equal(maintenanceControlRoot.includes('import rootRuntime from "./backup-selective-restore-root-entry.ts"'), true);
  assert.equal(serviceAdminGate.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(maintenanceGate.includes("rootRuntime"), false);
  assert.equal(securityComposition.includes('from "./maintenance-mode-gate.ts"'), true);
  assert.equal(securityComposition.includes('import compatibilityRuntime from "./maintenance-control-root-entry.ts"'), true);
  assert.equal(securityComposition.includes('from "./middleware/service-admin-authentication.ts"'), true);
  assert.equal(application.includes('import securityComposition from "./security-composition.ts"'), true);
  assert.equal(schemaRoot.includes('import rootRuntime from "./application.ts"'), true);
  assert.equal(httpSecurityRoot.includes('import rootRuntime from "./schema-migrations-entry.ts"'), true);
  assert.equal(layout.includes("<FreeIpaUserBrowser />"), true);
  assert.equal(vite.includes('main: "./worker/http-security-root-entry.ts"'), true);
});
