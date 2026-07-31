import assert from "node:assert/strict";
import test from "node:test";

import {
  portalPermissionMetadata,
  portalPermissionOrder,
  portalRolePermissions,
} from "../portal-permissions.ts";
import worker from "../dist/server/index.js";
import { markSchemaTestBypass } from "../worker/schema-migrations-boundary.ts";

const assignments = JSON.stringify({
  "viewer@example.test": "viewer",
  "operator@example.test": "operator",
  "admin@example.test": "admin",
});

function request(email) {
  return new Request("https://dashboard.test/api/integrations/status", {
    headers: { "oai-authenticated-user-email": email },
  });
}

const env = markSchemaTestBypass({
  DEMO_MODE: "true",
  PORTAL_IDENTITY_MODE: "workspace",
  PORTAL_DEFAULT_ROLE: "viewer",
  PORTAL_RBAC_JSON: assignments,
});

test("backup permissions are granted only to the default admin role", async () => {
  const viewer = await (await worker.fetch(request("viewer@example.test"), env, {})).json();
  const operator = await (await worker.fetch(request("operator@example.test"), env, {})).json();
  const admin = await (await worker.fetch(request("admin@example.test"), env, {})).json();

  for (const permission of ["backup.export", "backup.export.encrypted", "backup.restore.test"]) {
    assert.equal(viewer.access.permissions.includes(permission), false, permission);
    assert.equal(operator.access.permissions.includes(permission), false, permission);
    assert.equal(admin.access.permissions.includes(permission), true, permission);
  }
});

test("every browser-visible role permission has complete metadata", () => {
  for (const permission of portalPermissionOrder) {
    const metadata = portalPermissionMetadata[permission];
    assert.equal(typeof metadata?.title, "string", `missing title for ${permission}`);
    assert.equal(typeof metadata?.shortTitle, "string", `missing short title for ${permission}`);
    assert.equal(typeof metadata?.description, "string", `missing description for ${permission}`);
    assert.equal(typeof metadata?.scope, "string", `missing scope for ${permission}`);
  }
  assert.equal(portalRolePermissions.admin.includes("backup.export"), true);
  assert.equal(portalRolePermissions.admin.includes("backup.export.encrypted"), true);
  assert.equal(portalRolePermissions.admin.includes("backup.restore.test"), true);
});

test("runtime permissions exactly match the shared browser role catalogue", async () => {
  for (const [email, role] of [
    ["viewer@example.test", "viewer"],
    ["operator@example.test", "operator"],
    ["admin@example.test", "admin"],
  ]) {
    const payload = await (await worker.fetch(request(email), env, {})).json();
    assert.deepEqual(payload.access.permissions, portalRolePermissions[role]);
    for (const permission of payload.access.permissions) {
      assert.ok(portalPermissionMetadata[permission], `runtime permission has no browser metadata: ${permission}`);
    }
  }
});