import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  handleMaintenanceControlRoute,
} from "../worker/maintenance-control-dispatch.ts";
import {
  MAINTENANCE_ENTER_PATH,
  MAINTENANCE_PREPARE_PATH,
  MAINTENANCE_STATUS_PATH,
} from "../worker/maintenance-control-entry.ts";
import {
  portalPermissionMetadata,
  portalPermissionOrder,
  portalRolePermissions,
} from "../portal-permissions.ts";
import { isAdminIntegrationPath } from "../admin-session-authorization.ts";

function request(path, headers = {}) {
  return new Request(`https://portal.example${path}`, {
    method: path === MAINTENANCE_STATUS_PATH ? "GET" : "POST",
    headers: { origin: "https://portal.example", ...headers },
  });
}

test("maintenance.manage is admin-only and has safe browser metadata", () => {
  assert.equal(portalPermissionOrder.includes("maintenance.manage"), true);
  assert.equal(portalRolePermissions.viewer.includes("maintenance.manage"), false);
  assert.equal(portalRolePermissions.operator.includes("maintenance.manage"), false);
  assert.equal(portalRolePermissions.admin.includes("maintenance.manage"), true);
  assert.equal(portalPermissionMetadata["maintenance.manage"].scope, "Portal");
  assert.ok(portalPermissionMetadata["maintenance.manage"].title);
  assert.ok(portalPermissionMetadata["maintenance.manage"].description);
});

test("viewer and operator are denied before handler or audit-context creation", async () => {
  for (const role of ["viewer", "operator"]) {
    let handlerCalls = 0;
    let contextCalls = 0;
    const response = await handleMaintenanceControlRoute(
      request(MAINTENANCE_ENTER_PATH, { "oai-authenticated-user-email": `${role}@example.test` }),
      {
        PORTAL_DEFAULT_ROLE: role,
        DB: {},
      },
      {
        async handler() { handlerCalls += 1; return new Response("unexpected"); },
        createContext() { contextCalls += 1; throw new Error("unexpected"); },
      },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Insufficient permission for this operation",
      requiredPermission: "maintenance.manage",
      role,
    });
    assert.equal(handlerCalls, 0);
    assert.equal(contextCalls, 0);
  }
});

test("administrator dispatches maintenance routes and ignores other paths", async () => {
  let handlerCalls = 0;
  for (const path of [MAINTENANCE_STATUS_PATH, MAINTENANCE_PREPARE_PATH, MAINTENANCE_ENTER_PATH]) {
    const response = await handleMaintenanceControlRoute(
      request(path),
      { PORTAL_DEFAULT_ROLE: "admin", DB: {} },
      {
        createContext(access) {
          assert.equal(access.role, "admin");
          return { correlationId: "cor_11111111111111111111", actor: access };
        },
        async handler(req, env, context) {
          handlerCalls += 1;
          assert.equal(req.url.endsWith(path), true);
          assert.equal(context.actor.role, "admin");
          return new Response(JSON.stringify({ ok: true }));
        },
      },
    );
    assert.equal(response.status, 200);
  }
  assert.equal(handlerCalls, 3);
  assert.equal(await handleMaintenanceControlRoute(request("/api/other"), { PORTAL_DEFAULT_ROLE: "admin" }), null);
});

test("every maintenance control path is inside the service-admin allowlist", () => {
  for (const path of [
    "/api/admin/maintenance/status",
    "/api/admin/maintenance/prepare",
    "/api/admin/maintenance/enter",
    "/api/admin/maintenance/verification/start",
    "/api/admin/maintenance/exit",
    "/api/admin/maintenance/complete",
    "/api/admin/maintenance/cancel",
  ]) assert.equal(isAdminIntegrationPath(path), true, path);
});

test("service-admin root composes the maintenance control root", () => {
  const serviceRoot = fs.readFileSync(new URL("../worker/service-admin-root-entry.ts", import.meta.url), "utf8");
  const maintenanceRoot = fs.readFileSync(new URL("../worker/maintenance-control-root-entry.ts", import.meta.url), "utf8");
  assert.equal(serviceRoot.includes('from "./maintenance-control-root-entry"'), true);
  assert.equal(maintenanceRoot.includes('from "./backup-selective-restore-root-entry"'), true);
  assert.equal(maintenanceRoot.includes("handleMaintenanceControlRoute"), true);
});
