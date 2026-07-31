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

test("backup.export is granted only to the default admin role", async () => {
  const viewer = await (await worker.fetch(request("viewer@example.test"), env, {})).json();
  const operator = await (await worker.fetch(request("operator@example.test"), env, {})).json();
  const admin = await (await worker.fetch(request("admin@example.test"), env, {})).json();

  assert.equal(viewer.access.permissions.includes("backup.export"), false);
  assert.equal(operator.access.permissions.includes("backup.export"), false);
  assert.equal(admin.access.permissions.includes("backup.export"), true);
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
});

test("runtime admin permissions are representable by the browser permission catalogue", async () => {
  const admin = await (await worker.fetch(request("admin@example.test"), env, {})).json();
  for (const permission of admin.access.permissions) {
    assert.ok(portalPermissionMetadata[permission], `runtime permission has no browser metadata: ${permission}`);
  }
});
