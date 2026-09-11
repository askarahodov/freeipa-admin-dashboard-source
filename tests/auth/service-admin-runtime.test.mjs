import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isAdminIntegrationPath,
  serviceAdminTokenAuthorized,
} from "../../src/auth/admin-session-authorization.ts";
import { handleMaintenanceControlRoute } from "../../worker/maintenance-control-dispatch.ts";

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

test("service-admin token helper fails closed for missing and mismatched markers", async () => {
  assert.equal(await serviceAdminTokenAuthorized(request(), expectedMarker), false);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, mismatchedMarker), expectedMarker), false);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, expectedMarker), expectedMarker), true);
  assert.equal(await serviceAdminTokenAuthorized(request(maintenanceStatusPath, expectedMarker), undefined), false);
});

test("service-admin root keeps local mode, allowlist and token as one adaptation gate", () => {
  const local = serviceAdminRoot.indexOf("localMode(sourceEnv)");
  const allowlisted = serviceAdminRoot.indexOf("isAdminIntegrationPath(url.pathname)");
  const token = serviceAdminRoot.indexOf("serviceAdminTokenAuthorized(request, sourceEnv.ADMIN_TOKEN)");
  const adaptation = serviceAdminRoot.indexOf("serviceAdminEnv(sourceEnv)");
  const fallback = serviceAdminRoot.lastIndexOf("rootRuntime.fetch(request, sourceEnv, ctx)");

  assert.ok(local >= 0, "service-admin adaptation must remain local-mode-only");
  assert.ok(allowlisted > local, "route allowlist must remain inside the service-admin gate");
  assert.ok(token > allowlisted, "token authorization must remain inside the service-admin gate");
  assert.ok(adaptation > token, "service-admin identity adaptation must happen only after authorization");
  assert.ok(fallback > adaptation, "ordinary requests must retain the unadapted environment fallback");

  assert.equal(isAdminIntegrationPath(maintenanceStatusPath), true);
  assert.equal(isAdminIntegrationPath("/api/integrations/catalog"), false);
  assert.equal(isAdminIntegrationPath("/api/auth/users"), false);
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
