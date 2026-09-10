import assert from "node:assert/strict";
import test from "node:test";

import serviceAdminRuntime from "../../worker/service-admin-root-entry.ts";

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

const expectedMarker = "fixture-alpha";
const mismatchedMarker = "fixture-beta";

function localEnv() {
  return {
    PORTAL_IDENTITY_MODE: "local",
    PORTAL_DEFAULT_ROLE: "viewer",
    ADMIN_TOKEN: expectedMarker,
  };
}

function maintenanceStatusRequest(marker) {
  const headers = new Headers();
  if (marker !== undefined) headers.set("x-admin-token", marker);
  return new Request("https://portal.test/api/admin/maintenance/status", { headers });
}

test("service-admin maintenance access requires the configured token at runtime", async () => {
  const missing = await serviceAdminRuntime.fetch(maintenanceStatusRequest(undefined), localEnv(), context);
  assert.equal(missing.status, 403);
  assert.deepEqual(await missing.json(), {
    error: "Insufficient permission for this operation",
    requiredPermission: "maintenance.manage",
    role: "viewer",
  });

  const wrong = await serviceAdminRuntime.fetch(maintenanceStatusRequest(mismatchedMarker), localEnv(), context);
  assert.equal(wrong.status, 403);
  assert.deepEqual(await wrong.json(), {
    error: "Insufficient permission for this operation",
    requiredPermission: "maintenance.manage",
    role: "viewer",
  });

  const authorized = await serviceAdminRuntime.fetch(
    maintenanceStatusRequest(expectedMarker),
    localEnv(),
    context,
  );
  assert.equal(authorized.status, 503, "valid token must cross service-admin authorization and reach the maintenance handler");
  assert.deepEqual(await authorized.json(), {
    error: "Maintenance state is unavailable",
    code: "maintenance_state_unavailable",
  });
});

test("service-admin token is not a universal bypass for local-session routes", async () => {
  const request = new Request("https://portal.test/api/integrations/catalog", {
    headers: { "x-admin-token": expectedMarker },
  });
  const response = await serviceAdminRuntime.fetch(request, localEnv(), context);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Требуется вход в портал" });
});

test("service-admin token adaptation is disabled outside local identity mode", async () => {
  const env = {
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "viewer@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "viewer@example.test": "viewer" }),
    ADMIN_TOKEN: expectedMarker,
  };
  const response = await serviceAdminRuntime.fetch(
    maintenanceStatusRequest(expectedMarker),
    env,
    context,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Insufficient permission for this operation",
    requiredPermission: "maintenance.manage",
    role: "viewer",
  });
});
