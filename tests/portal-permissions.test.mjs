import assert from "node:assert/strict";
import test from "node:test";

import {
  portalPermissionMetadata,
  portalPermissionOrder,
  portalRolePermissions,
  portalRoles,
  roleHasPermission,
} from "../portal-permissions.ts";

const selectiveRestorePermissions = [
  "backup.restore.prepare",
  "backup.restore.commit",
  "backup.restore.cancel",
];
const maintenancePermissions = ["maintenance.manage"];

test("portal permission matrix matches the runtime RBAC contract", () => {
  assert.deepEqual(portalRoles, ["viewer", "operator", "admin"]);
  assert.deepEqual(portalPermissionOrder, [
    "directory.read",
    "freeipa.write",
    "freeipa.delete",
    "xyops.run",
    "xyops.approve",
    "settings.manage",
    "backup.export",
    "backup.export.encrypted",
    "backup.restore.preview",
    "backup.restore.test",
    ...selectiveRestorePermissions,
    ...maintenancePermissions,
  ]);
  assert.deepEqual(portalRolePermissions, {
    viewer: ["directory.read"],
    operator: ["directory.read", "freeipa.write", "xyops.run"],
    admin: [
      "directory.read",
      "freeipa.write",
      "freeipa.delete",
      "xyops.run",
      "xyops.approve",
      "settings.manage",
      "backup.export",
      "backup.export.encrypted",
      "backup.restore.preview",
      "backup.restore.test",
      ...selectiveRestorePermissions,
      ...maintenancePermissions,
    ],
  });
});

test("roleHasPermission denies permissions that are not explicitly granted", () => {
  assert.equal(roleHasPermission("viewer", "directory.read"), true);
  assert.equal(roleHasPermission("viewer", "freeipa.write"), false);
  assert.equal(roleHasPermission("operator", "freeipa.delete"), false);
  assert.equal(roleHasPermission("operator", "xyops.approve"), false);
  assert.equal(roleHasPermission("admin", "settings.manage"), true);
  assert.equal(roleHasPermission("admin", "backup.export"), true);
  assert.equal(roleHasPermission("viewer", "backup.export.encrypted"), false);
  assert.equal(roleHasPermission("admin", "backup.export.encrypted"), true);
  assert.equal(roleHasPermission("viewer", "backup.restore.preview"), false);
  assert.equal(roleHasPermission("operator", "backup.restore.preview"), false);
  assert.equal(roleHasPermission("admin", "backup.restore.preview"), true);
  assert.equal(roleHasPermission("viewer", "backup.restore.test"), false);
  assert.equal(roleHasPermission("operator", "backup.restore.test"), false);
  assert.equal(roleHasPermission("admin", "backup.restore.test"), true);
  for (const permission of [...selectiveRestorePermissions, ...maintenancePermissions]) {
    assert.equal(roleHasPermission("viewer", permission), false, permission);
    assert.equal(roleHasPermission("operator", permission), false, permission);
    assert.equal(roleHasPermission("admin", permission), true, permission);
  }
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
