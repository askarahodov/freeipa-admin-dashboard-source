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
  assert.equal(portalSecurityGateOrder[0].owner, "worker/security-composition.ts");
  assert.equal(portalSecurityGateOrder[1].owner, "worker/security-composition.ts");
  assert.equal(portalSecurityGateOrder[2].owner, "worker/security-composition.ts");
  assert.equal(portalSecurityGateOrder[3].owner, "worker/middleware/local-security-routing.ts");
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

  const localRouting = read("../../worker/middleware/local-security-routing.ts");
  const ordinarySession = localRouting.indexOf("dependencies.resolveSession(env, request)");
  const ordinaryOrigin = localRouting.indexOf("sameOriginAdminMutation(request)", ordinarySession);
  assert.ok(ordinarySession >= 0 && ordinaryOrigin > ordinarySession);
  assert.equal(localSecure.includes("handleLocalSecurityRouting(request, sourceEnv, ctx"), true);
});

test("application enters security composition with storage migration then maintenance as explicit gates", () => {
  const application = read("../../worker/application.ts");
  const securityComposition = read("../../worker/security-composition.ts");
  const migrationMiddleware = read("../../worker/middleware/storage-migration-apply.ts");
  const maintenanceGate = read("../../worker/maintenance-mode-gate.ts");

  assert.equal(application.includes('from "./security-composition.ts"'), true);
  assert.equal(application.includes('from "./maintenance-mode-root-entry.ts"'), false);
  assert.equal(securityComposition.includes('from "./security-composition-contract.ts"'), true);
  assert.equal(securityComposition.includes('from "./storage-migration-apply-entry.ts"'), true);
  assert.equal(securityComposition.includes('from "./middleware/storage-migration-apply.ts"'), true);
  assert.equal(securityComposition.includes('from "./maintenance-mode-gate.ts"'), true);
  assert.equal(securityComposition.includes('import compatibilityRuntime from "./maintenance-control-root-entry.ts"'), true);
  assert.equal(securityComposition.includes('from "./middleware/service-admin-authentication.ts"'), true);
  assert.equal(securityComposition.includes('from "./maintenance-mode-root-entry.ts"'), false);
  assert.equal(securityComposition.includes("handleStorageMigrationApplyGate(request, env, ctx"), true);
  assert.equal(securityComposition.includes("handleApply: handleStorageMigrationApplyRequest"), true);
  assert.equal(securityComposition.includes("handleMaintenanceGate("), true);
  assert.equal(securityComposition.includes("handleMaintenanceScheduledGate("), true);
  assert.equal(securityComposition.includes("compatibilityRuntime.fetch(request, env, ctx)"), true);
  assert.equal(migrationMiddleware.includes("if (response) return response"), true);
  assert.equal(migrationMiddleware.includes("dependencies.nextFetch(request, env, ctx)"), true);
  assert.equal(maintenanceGate.includes("dependencies.nextFetch(request, env, ctx)"), true);
  assert.equal(maintenanceGate.includes("dependencies.nextScheduled(controller, env, ctx)"), true);
});

test("explicit composition owns outer service-admin adaptation while local security remains at the compatibility position", () => {
  const securityComposition = read("../../worker/security-composition.ts");
  const serviceAdminGate = read("../../worker/middleware/service-admin-authentication.ts");

  assert.equal(securityComposition.includes('import compatibilityRuntime from "./maintenance-control-root-entry.ts"'), true);
  assert.equal(securityComposition.includes('from "./middleware/service-admin-authentication.ts"'), true);
  assert.equal(securityComposition.includes("handleServiceAdminAuthenticationGate(request, env, ctx, compatibilityDependencies())"), true);
  assert.equal(serviceAdminGate.includes("localMode(env)"), true);
  assert.equal(serviceAdminGate.includes("isAdminIntegrationPath(url.pathname)"), true);
  assert.equal(serviceAdminGate.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(serviceAdminGate.includes('PORTAL_SERVICE_ADMIN_AUTHORIZED: "1"'), true);
  assert.equal(securityComposition.includes("service-admin-root-entry"), false);
});

test("local session and service-admin remain separate mechanisms with fail-closed ownership", () => {
  const localSecure = read("../../worker/local-secure-entry.ts");
  const localRouting = read("../../worker/middleware/local-security-routing.ts");

  assert.equal(localSecure.includes("handleLocalSecurityRouting(request, sourceEnv, ctx"), true);
  assert.equal(localRouting.includes("dependencies.resolveSession(env, request)"), true);
  assert.equal(localRouting.includes("sameOriginAdminMutation(request)"), true);
  assert.equal(localRouting.includes("isAdminIntegrationPath(url.pathname)"), true);
  assert.equal(localRouting.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(localRouting.includes('json({ error: "Требуется вход в портал" }, 401)'), true);

  const sessionIndex = localRouting.indexOf("dependencies.resolveSession(env, request)");
  const serviceAdminFallbackIndex = localRouting.indexOf("isAdminIntegrationPath(url.pathname)", sessionIndex);
  assert.ok(sessionIndex >= 0 && serviceAdminFallbackIndex > sessionIndex);
});

test("composition cutover does not introduce a new admin default or principal adaptation", () => {
  const source = read("../../worker/security-composition.ts");
  const migrationMiddleware = read("../../worker/middleware/storage-migration-apply.ts");
  const maintenanceGate = read("../../worker/maintenance-mode-gate.ts");
  const serviceAdminGate = read("../../worker/middleware/service-admin-authentication.ts");
  const preServiceAdmin = `${migrationMiddleware}\n${maintenanceGate}`;
  assert.equal(preServiceAdmin.includes("PORTAL_DEFAULT_ROLE"), false);
  assert.equal(preServiceAdmin.includes("PORTAL_STATIC_IDENTITY"), false);
  assert.equal(preServiceAdmin.includes("ADMIN_TOKEN"), false);
  assert.equal(source.includes("PORTAL_DEFAULT_ROLE"), true, "composition type surface reflects the explicit service-admin gate");
  assert.equal(serviceAdminGate.includes('PORTAL_DEFAULT_ROLE: "admin"'), true);
  assert.equal(serviceAdminGate.includes('PORTAL_STATIC_IDENTITY: identity'), true);
  assert.equal(serviceAdminGate.includes("serviceAdminTokenAuthorized"), true);
  assert.equal(`${source}\n${serviceAdminGate}`.includes("request.headers.set"), false);
});
