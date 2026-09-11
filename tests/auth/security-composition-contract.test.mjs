import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  portalAuthenticationMechanisms,
  portalSecurityGateOrder,
} from "../../worker/security-composition-contract.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("security composition publishes one ordered migration contract", () => {
  assert.deepEqual(
    portalSecurityGateOrder.map((gate) => gate.id),
    [
      "storage-migration-apply",
      "maintenance",
      "service-admin-authentication",
      "local-session-authentication",
      "mutation-origin",
      "authorization-and-domain",
      "audit-and-error",
    ],
  );
  assert.deepEqual(
    portalAuthenticationMechanisms,
    ["anonymous", "local-session", "service-admin"],
  );
  assert.equal(new Set(portalSecurityGateOrder.map((gate) => gate.id)).size, portalSecurityGateOrder.length);
});

test("application enters the compatibility runtime only through the security composition seam", () => {
  const application = read("../../worker/application.ts");
  const securityComposition = read("../../worker/security-composition.ts");

  assert.equal(application.includes('from "./security-composition.ts"'), true);
  assert.equal(application.includes('from "./maintenance-mode-root-entry.ts"'), false);
  assert.equal(securityComposition.includes('from "./security-composition-contract.ts"'), true);
  assert.equal(securityComposition.includes('from "./maintenance-mode-root-entry.ts"'), true);
  assert.equal(securityComposition.includes("compatibilityRuntime.fetch(request, env, ctx)"), true);
});

test("compatibility ownership preserves maintenance before service-admin adaptation", () => {
  const maintenanceRoot = read("../../worker/maintenance-mode-root-entry.ts");
  const serviceAdminRoot = read("../../worker/service-admin-root-entry.ts");

  assert.equal(maintenanceRoot.includes('from "./service-admin-root-entry.ts"'), true);
  assert.ok(maintenanceRoot.indexOf("handleStorageMigrationApplyRequest") < maintenanceRoot.indexOf("handleMaintenanceGate(request"));
  assert.equal(serviceAdminRoot.includes("localMode(sourceEnv)"), true);
  assert.equal(serviceAdminRoot.includes("isAdminIntegrationPath(url.pathname)"), true);
  assert.equal(serviceAdminRoot.includes("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)"), true);
  assert.equal(serviceAdminRoot.includes("PORTAL_SERVICE_ADMIN_AUTHORIZED: \"1\""), true);
});

test("local session and service-admin remain separate mechanisms with fail-closed mutation ownership", () => {
  const localSecure = read("../../worker/local-secure-entry.ts");

  assert.equal(localSecure.includes("resolveLocalSession(sourceEnv, request)"), true);
  assert.equal(localSecure.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localSecure.includes("isAdminIntegrationPath(url.pathname)"), true);
  assert.equal(localSecure.includes("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)"), true);
  assert.equal(localSecure.includes('json({ error: "Требуется вход в портал" }, 401)'), true);

  const sessionIndex = localSecure.indexOf("resolveLocalSession(sourceEnv, request)");
  const serviceAdminFallbackIndex = localSecure.indexOf("isAdminIntegrationPath(url.pathname)", sessionIndex);
  assert.ok(sessionIndex >= 0 && serviceAdminFallbackIndex > sessionIndex);
});

test("compatibility seam does not introduce a new admin default or principal adaptation", () => {
  const source = read("../../worker/security-composition.ts");
  assert.equal(source.includes("PORTAL_DEFAULT_ROLE"), false);
  assert.equal(source.includes("PORTAL_STATIC_IDENTITY"), false);
  assert.equal(source.includes("ADMIN_TOKEN"), false);
  assert.equal(source.includes("request.headers.set"), false);
});
