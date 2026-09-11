import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isAdminIntegrationPath,
  serviceAdminTokenAuthorized,
} from "../../src/auth/admin-session-authorization.ts";
import { handleMaintenanceControlRoute } from "../../worker/maintenance-control-dispatch.ts";
import { handleServiceAdminAuthenticationGate } from "../../worker/middleware/service-admin-authentication.ts";

const serviceAdminGateSource = fs.readFileSync(
  new URL("../../worker/middleware/service-admin-authentication.ts", import.meta.url),
  "utf8",
);
const securityCompositionSource = fs.readFileSync(
  new URL("../../worker/security-composition.ts", import.meta.url),
  "utf8",
);

const expectedMarker = "fixture-alpha";
const mismatchedMarker = "fixture-beta";
const maintenanceStatusPath = "/api/admin/maintenance/status";

function request(path = maintenanceStatusPath, marker) {
  const headers = new Headers();
  if (marker !== undefined) headers.set("x-admin-token", marker);
  return new Request(`https://portal.test${path}`, { headers });
}

async function observeGate(inputRequest, env) {
  const ctx = { marker: "ctx" };
  const expectedResponse = new Response("delegated", { status: 202 });
  const calls = [];
  const response = await handleServiceAdminAuthenticationGate(inputRequest, env, ctx, {
    nextFetch(nextRequest, nextEnv, nextContext) {
      calls.push({ request: nextRequest, env: nextEnv, ctx: nextContext });
      return Promise.resolve(expectedResponse);
    },
  });
  return { response, expectedResponse, calls, ctx };
}

test("service-admin token helper fails closed for missing and mismatched markers", async () => {
  assert.equal(await serviceAdminTokenAuthorized(request(), expectedMarker), false);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, mismatchedMarker), expectedMarker), false);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, expectedMarker), expectedMarker), true);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, expectedMarker), undefined), false);
});

test("explicit service-admin gate keeps local mode, allowlist and token as one ordered adaptation boundary", () => {
  const local = serviceAdminGateSource.indexOf("localMode(env)");
  const allowlisted = serviceAdminGateSource.indexOf("isAdminIntegrationPath(url.pathname)");
  const token = serviceAdminGateSource.indexOf("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)");
  const adaptation = serviceAdminGateSource.indexOf("serviceAdminEnv(env)");
  const fallback = serviceAdminGateSource.lastIndexOf("dependencies.nextFetch(request, env, ctx)");

  assert.ok(local >= 0, "service-admin adaptation must remain local-mode-only");
  assert.ok(allowlisted > local, "route allowlist must remain inside the service-admin gate");
  assert.ok(token > allowlisted, "token authorization must remain inside the service-admin gate");
  assert.ok(adaptation > token, "service-admin identity adaptation must happen only after authorization");
  assert.ok(fallback > adaptation, "ordinary requests must retain the unadapted environment fallback");

  assert.match(securityCompositionSource, /import compatibilityRuntime from "\.\/maintenance-control-root-entry\.ts"/);
  assert.match(securityCompositionSource, /from "\.\/middleware\/service-admin-authentication\.ts"/);
  assert.match(securityCompositionSource, /handleServiceAdminAuthenticationGate\(request, env, ctx, compatibilityDependencies\(\)\)/);
  assert.doesNotMatch(securityCompositionSource, /service-admin-root-entry/);

  assert.equal(isAdminIntegrationPath(maintenanceStatusPath), true);
  assert.equal(isAdminIntegrationPath("/api/integrations/catalog"), false);
  assert.equal(isAdminIntegrationPath("/api/auth/users"), false);
});

test("service-admin gate preserves exact fallback identity for missing wrong nonlocal and nonallowlisted tokens", async () => {
  const cases = [
    request(maintenanceStatusPath),
    request(maintenanceStatusPath, mismatchedMarker),
    request("/api/auth/users", expectedMarker),
  ];

  for (const inputRequest of cases) {
    const env = { PORTAL_IDENTITY_MODE: "local", ADMIN_TOKEN: expectedMarker, marker: Symbol("env") };
    const observed = await observeGate(inputRequest, env);
    assert.equal(observed.response, observed.expectedResponse);
    assert.equal(observed.calls.length, 1);
    assert.equal(observed.calls[0].request, inputRequest);
    assert.equal(observed.calls[0].env, env);
    assert.equal(observed.calls[0].ctx, observed.ctx);
  }

  const staticRequest = request(maintenanceStatusPath, expectedMarker);
  const staticEnv = { PORTAL_IDENTITY_MODE: "static", ADMIN_TOKEN: expectedMarker, marker: Symbol("env") };
  const staticObserved = await observeGate(staticRequest, staticEnv);
  assert.equal(staticObserved.calls.length, 1);
  assert.equal(staticObserved.calls[0].env, staticEnv, "valid token must not elevate non-local identity mode");
});

test("authorized local service-admin adapts only environment while preserving request context and original env", async () => {
  const inputRequest = request(maintenanceStatusPath, expectedMarker);
  const marker = { preserved: true };
  const env = {
    PORTAL_IDENTITY_MODE: "local",
    PORTAL_STATIC_IDENTITY: "untrusted-existing",
    PORTAL_STATIC_NAME: "Untrusted existing",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "untrusted-existing": "viewer" }),
    ADMIN_TOKEN: expectedMarker,
    marker,
  };
  const observed = await observeGate(inputRequest, env);

  assert.equal(observed.response, observed.expectedResponse);
  assert.equal(observed.calls.length, 1);
  assert.equal(observed.calls[0].request, inputRequest);
  assert.equal(observed.calls[0].ctx, observed.ctx);
  assert.notEqual(observed.calls[0].env, env);
  assert.equal(observed.calls[0].env.marker, marker);
  assert.equal(observed.calls[0].env.ADMIN_TOKEN, expectedMarker);
  assert.equal(observed.calls[0].env.PORTAL_IDENTITY_MODE, "static");
  assert.equal(observed.calls[0].env.PORTAL_STATIC_IDENTITY, "service-admin@portal.local");
  assert.equal(observed.calls[0].env.PORTAL_STATIC_NAME, "Service administrator");
  assert.equal(observed.calls[0].env.PORTAL_DEFAULT_ROLE, "admin");
  assert.equal(observed.calls[0].env.PORTAL_RBAC_JSON, JSON.stringify({ "service-admin@portal.local": "admin" }));
  assert.equal(observed.calls[0].env.PORTAL_SERVICE_ADMIN_AUTHORIZED, "1");

  assert.equal(env.PORTAL_IDENTITY_MODE, "local", "source environment must not be mutated");
  assert.equal(env.PORTAL_STATIC_IDENTITY, "untrusted-existing");
  assert.equal("PORTAL_SERVICE_ADMIN_AUTHORIZED" in env, false);
});

test("maintenance runtime preserves viewer operator admin and service-admin authorization", async () => {
  for (const role of ["viewer", "operator"]) {
    const response = await handleMaintenanceControlRoute(
      request(),
      { PORTAL_DEFAULT_ROLE: role },
    );
    assert.equal(response?.status, 403);
    assert.deepEqual(await response?.json(), {
      error: "Insufficient permission for this operation",
      requiredPermission: "maintenance.manage",
      role,
    });
  }

  const admin = await handleMaintenanceControlRoute(
    request(),
    { PORTAL_DEFAULT_ROLE: "admin" },
  );
  assert.equal(admin?.status, 503, "administrator must cross RBAC and reach the DB-backed handler");
  assert.deepEqual(await admin?.json(), {
    error: "Maintenance state is unavailable",
    code: "maintenance_state_unavailable",
  });

  const serviceAdmin = await handleMaintenanceControlRoute(
    request(),
    {
      PORTAL_IDENTITY_MODE: "static",
      PORTAL_STATIC_IDENTITY: "service-admin@portal.local",
      PORTAL_DEFAULT_ROLE: "admin",
      PORTAL_RBAC_JSON: JSON.stringify({ "service-admin@portal.local": "admin" }),
      PORTAL_SERVICE_ADMIN_AUTHORIZED: "1",
    },
  );
  assert.equal(serviceAdmin?.status, 503, "authorized service-admin identity must preserve admin maintenance access");
});

test("service-admin verification capability remains explicitly narrower than ordinary admin", async () => {
  const smokePath = "/api/admin/maintenance/verification/smoke";
  const ordinaryAdmin = await handleMaintenanceControlRoute(
    request(smokePath),
    { PORTAL_DEFAULT_ROLE: "admin" },
  );
  assert.equal(ordinaryAdmin?.status, 403);
  assert.deepEqual(await ordinaryAdmin?.json(), {
    error: "Insufficient permission for this operation",
    requiredPermission: "maintenance.verify.service-admin",
    role: "admin",
  });
});
