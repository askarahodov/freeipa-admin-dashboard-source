import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("user browser exposes RBAC-aware bulk controls and filtered CSV export", () => {
  const component = fs.readFileSync(new URL("../../app/directory/FreeIpaUserBrowser.tsx", import.meta.url), "utf8");
  const owner = fs.readFileSync(new URL("../../worker/freeipa-http-entry.ts", import.meta.url), "utf8");
  const selectiveRoot = fs.readFileSync(new URL("../../worker/backup-selective-restore-root-entry.ts", import.meta.url), "utf8");
  const secureEntry = fs.readFileSync(new URL("../../worker/secure-entry.ts", import.meta.url), "utf8");
  const maintenanceControlRoot = fs.readFileSync(new URL("../../worker/maintenance-control-root-entry.ts", import.meta.url), "utf8");
  const serviceAdminGate = fs.readFileSync(new URL("../../worker/middleware/service-admin-authentication.ts", import.meta.url), "utf8");
  const maintenanceGate = fs.readFileSync(new URL("../../worker/maintenance-mode-gate.ts", import.meta.url), "utf8");
  const securityComposition = fs.readFileSync(new URL("../../worker/security-composition.ts", import.meta.url), "utf8");
  const application = fs.readFileSync(new URL("../../worker/application.ts", import.meta.url), "utf8");
  const schemaRoot = fs.readFileSync(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
  const httpSecurityRoot = fs.readFileSync(new URL("../../worker/http-security-root-entry.ts", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");

  assert.equal(component.includes("/api/integrations/freeipa/bulk"), true);
  assert.equal(component.includes("/api/integrations/users/export.csv"), true);
  assert.equal(component.includes("/api/integrations/freeipa/actions"), false);
  assert.equal(component.includes('canWrite && payload?.mode === "live"'), true);
  assert.equal(component.includes("Выбрать текущую страницу"), true);
  assert.equal(component.includes("Подтвердите массовую операцию"), true);
  assert.equal(component.includes("maxBulkUsers = 50"), true);
  assert.equal(component.includes("bulkResult.results.filter"), true);

  assert.equal(owner.includes("preflightWrite"), true);
  assert.equal(owner.includes('permissions.includes("freeipa.write")'), true);
  assert.equal(owner.includes("maxBulkUsers = 50"), true);
  assert.equal(owner.includes("bulkConcurrency = 3"), true);
  assert.equal(owner.includes("207"), true);
  assert.equal(owner.includes("csvCell"), true);
  assert.equal(owner.includes("integrationRuntime.fetch"), true);
  assert.equal(owner.includes("/api/integrations/freeipa/actions"), true);
  assert.equal(owner.includes("/api/integrations/groups/members"), true);

  assert.equal(selectiveRoot.includes('import rootRuntime from "./session-management-entry.ts"'), true);
  assert.equal(secureEntry.includes('import runtime from "./freeipa-http-entry.ts"'), true);
  assert.equal(maintenanceControlRoot.includes('import rootRuntime from "./backup-selective-restore-root-entry.ts"'), true);
  assert.equal(serviceAdminGate.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(maintenanceGate.includes("rootRuntime"), false);
  assert.equal(securityComposition.includes('from "./maintenance-mode-gate.ts"'), true);
  assert.equal(securityComposition.includes('import compatibilityRuntime from "./maintenance-control-root-entry.ts"'), true);
  assert.equal(securityComposition.includes('from "./middleware/service-admin-authentication.ts"'), true);
  assert.equal(application.includes('import securityComposition from "./security-composition.ts"'), true);
  assert.equal(schemaRoot.includes('import rootRuntime from "./application.ts"'), true);
  assert.equal(httpSecurityRoot.includes('import rootRuntime from "./schema-migrations-entry.ts"'), true);
  assert.equal(vite.includes('main: "./worker/http-security-root-entry.ts"'), true);
  assert.equal(layout.includes("freeipa-user-bulk.css"), true);
});
