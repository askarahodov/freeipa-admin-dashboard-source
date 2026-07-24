import assert from "node:assert/strict";
import test from "node:test";

import {
  portalPermissionMetadata,
  portalPermissionOrder,
  portalRolePermissions,
  portalRoles,
  roleHasPermission,
} from "../portal-permissions.ts";

test("portal permission matrix matches the runtime RBAC contract", () => {
  assert.deepEqual(portalRoles, ["viewer", "operator", "admin"]);
  assert.deepEqual(portalPermissionOrder, [
    "directory.read",
    "freeipa.write",
    "freeipa.delete",
    "xyops.run",
    "xyops.approve",
    "settings.manage",
  ]);
  assert.deepEqual(portalRolePermissions, {
    viewer: ["directory.read"],
    operator: ["directory.read", "freeipa.write", "xyops.run"],
    admin: ["directory.read", "freeipa.write", "freeipa.delete", "xyops.run", "xyops.approve", "settings.manage"],
  });
});

test("roleHasPermission denies permissions that are not explicitly granted", () => {
  assert.equal(roleHasPermission("viewer", "directory.read"), true);
  assert.equal(roleHasPermission("viewer", "freeipa.write"), false);
  assert.equal(roleHasPermission("operator", "freeipa.delete"), false);
  assert.equal(roleHasPermission("operator", "xyops.approve"), false);
  assert.equal(roleHasPermission("admin", "settings.manage"), true);
});

test("every permission has safe user-facing metadata", () => {
  for (const permission of portalPermissionOrder) {
    const metadata = portalPermissionMetadata[permission];
    assert.ok(metadata.title.length > 3, permission);
    assert.ok(metadata.description.length > 10, permission);
    assert.ok(["Portal", "FreeIPA", "XYOps"].includes(metadata.scope), permission);
    assert.doesNotMatch(JSON.stringify(metadata), /password|token|secret|api[_-]?key/i, permission);
  }
});
