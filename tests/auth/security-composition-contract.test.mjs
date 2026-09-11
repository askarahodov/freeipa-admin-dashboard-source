import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  portalAuthenticationMechanisms,
  portalLocalSecurityOrderProfiles,
  portalSecurityGateOrder,
} from "../../worker/security-composition-contract.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("security composition publishes the universal outer migration order", () => {
  assert.deepEqual(
    portalSecurityGateOrder.map((gate) => gate.id),
    [
      "storage-migration-apply",
      "maintenance",
      "service-admin-authentication",
      "local-security-routing",
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

test("local security profiles preserve route-specific origin and authentication ordering", () => {
  const profiles = new Map(portalLocalSecurityOrderProfiles.map((profile) => [profile.id, profile]));
  assert.deepEqual(
    profiles.get("local-auth-mutation")?.order,
    ["mutation-origin", "local-session-authorization"],
  );
  assert.deepEqual(
    profiles.get("local-admin-integration")?.order,
    ["local-session-authentication", "mutation-origin", "internal-token-delegation"],
  );
  assert.deepEqual(
    profiles.get("local-api-no-session")?.order,
    ["local-session-authentication", "service-admin-fallback", "anonymous-api-denial"],
  );

  const localSecure = read("../../worker/local-secure-entry.ts");
  const authHandlerStart = localSecure.indexOf("async function handleAuthApi");
  const authOrigin = localSecure.indexOf("sameOriginAdminMutation(request)", authHandlerStart);
  const authRequireAdmin = localSecure.indexOf("requireAdmin(env, request)", authOrigin);
  assert.ok(authHandlerStart >= 0 && authOrigin > authHandlerStart && authRequireAdmin > authOrigin);

  const workerFetchStart = localSecure.indexOf("const worker = {");
  const ordinarySession = localSecure.indexOf("resolveLocalSession(sourceEnv, request)", workerFetchStart);
  const ordinaryOrigin = localSecure.indexOf("sameOriginAdminMutation(request)", ordinarySession);
  assert.ok(workerFetchStart >= 0 && ordinarySession > workerFetchStart && ordinaryOrigin > ordinarySession);
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

test("local session and service-admin remain separate mechanisms with fail-closed ownership", () => {
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
