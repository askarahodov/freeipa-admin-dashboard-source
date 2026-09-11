import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isAdminIntegrationPath,
  serviceAdminTokenAuthorized,
} from "../../src/auth/admin-session-authorization.ts";
import { handleMaintenanceControlRoute } from "../../worker/maintenance-control-dispatch.ts";
import {
  resolveServiceAdminCompatibilityEnv,
  serviceAdminCompatibilityEnv,
} from "../../worker/security/service-admin-authentication.ts";

const serviceAdminRoot = fs.readFileSync(
  new URL("../../worker/service-admin-root-entry.ts", import.meta.url),
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

function localEnv() {
  return {
    PORTAL_IDENTITY_MODE: "local",
    PORTAL_DEFAULT_ROLE: "viewer",
    ADMIN_TOKEN: expectedMarker,
  };
}

test("service-admin token helper fails closed for missing and mismatched markers", async () => {
  assert.equal(await serviceAdminTokenAuthorized(request(), expectedMarker), false);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, mismatchedMarker), expectedMarker), false);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, expectedMarker), expectedMarker), true);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, expectedMarker), undefined), false);
});

test("service-admin authentication adapter preserves local-mode allowlist and token boundary", async () => {
  const env = localEnv();

  assert.equal(
    await resolveServiceAdminCompatibilityEnv(request(maintenanceStatusPath, mismatchedMarker), env),
    null,
  );
  assert.equal(
    await resolveServiceAdminCompatibilityEnv(request("/api/integrations/catalog", expectedMarker), env),
    null,
  );
  assert.equal(
    await resolveServiceAdminCompatibilityEnv(
      request(maintenanceStatusPath, expectedMarker),
      { ...env, PORTAL_IDENTITY_MODE: "static" },
    ),
    null,
  );

  const delegated = await resolveServiceAdminCompatibilityEnv(
    request(maintenanceStatusPath, expectedMarker),
    env,
  );
  assert.ok(delegated);
  assert.notEqual(delegated, env);
  assert.equal(env.PORTAL_IDENTITY_MODE, "local", "authentication must not mutate the source environment");
  assert.equal(delegated.PORTAL_IDENTITY_MODE, "static");
  assert.equal(delegated.PORTAL_STATIC_IDENTITY, "service-admin@portal.local");
  assert.equal(delegated.PORTAL_DEFAULT_ROLE, "admin");
  assert.equal(delegated.PORTAL_SERVICE_ADMIN_AUTHORIZED, "1");
  assert.deepEqual(JSON.parse(delegated.PORTAL_RBAC_JSON), {
    "service-admin@portal.local": "admin",
  });

  assert.equal(isAdminIntegrationPath(maintenanceStatusPath), true);
  assert.equal(isAdminIntegrationPath("/api/integrations/catalog"), false);
  assert.equal(isAdminIntegrationPath("/api/auth/users"), false);
});

test("service-admin compatibility environment keeps unrelated configuration intact", () => {
  const env = { ...localEnv(), UNRELATED_MARKER: "preserved" };
  const delegated = serviceAdminCompatibilityEnv(env);
  assert.equal(delegated.UNRELATED_MARKER, "preserved");
  assert.equal(env.PORTAL_IDENTITY_MODE, "local");
});

test("service-admin root is a thin adapter with an unadapted fallback", () => {
  assert.equal(
    serviceAdminRoot.includes("resolveServiceAdminCompatibilityEnv(request, sourceEnv)"),
    true,
  );
  assert.equal(
    serviceAdminRoot.includes("rootRuntime.fetch(request, delegated ?? sourceEnv, ctx)"),
    true,
  );
  assert.equal(serviceAdminRoot.includes("serviceAdminTokenAuthorized"), false);
  assert.equal(serviceAdminRoot.includes("serviceAdminEnv"), false);
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
