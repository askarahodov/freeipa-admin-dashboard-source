import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  portalPermissionOrder,
  portalRolePermissions,
  roleHasPermission,
} from "../../src/auth/portal-permissions.ts";
import { backupPreviewAccess } from "../../worker/backup-import-preview-root-entry.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const previewPermission = "backup.restore.preview";
const request = () => new Request("https://dashboard.test/api/admin/backups/import/preview", {
  method: "POST",
  headers: { "oai-authenticated-user-email": "operator@example.test" },
  body: "{}",
});

test("backup preview is part of the canonical permission vocabulary", () => {
  assert.ok(portalPermissionOrder.includes(previewPermission));
  assert.equal(roleHasPermission("viewer", previewPermission), false);
  assert.equal(roleHasPermission("operator", previewPermission), false);
  assert.equal(roleHasPermission("admin", previewPermission), true);
});

test("adding canonical preview permission preserves existing built-in role capabilities", () => {
  assert.deepEqual(portalRolePermissions.viewer, ["directory.read"]);
  assert.deepEqual(portalRolePermissions.operator, ["directory.read", "freeipa.write", "xyops.run"]);

  const adminWithoutPreview = portalRolePermissions.admin.filter((permission) => permission !== previewPermission);
  assert.deepEqual(adminWithoutPreview, [
    "directory.read",
    "freeipa.write",
    "freeipa.delete",
    "xyops.run",
    "xyops.approve",
    "settings.manage",
    "backup.export",
    "backup.export.encrypted",
    "backup.restore.test",
    "backup.restore.prepare",
    "backup.restore.commit",
    "backup.restore.cancel",
    "maintenance.manage",
  ]);
});

test("backup preview access exposes only canonical permissions", () => {
  const admin = backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "admin" });
  const operator = backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "operator" });

  assert.deepEqual(admin.permissions, [previewPermission]);
  assert.deepEqual(operator.permissions, []);
  for (const permission of admin.permissions) {
    assert.ok(portalPermissionOrder.includes(permission));
  }
});

test("runtime route owners do not maintain duplicate portal permission registries", async () => {
  const [workerIndex, operationsOwner, auditOwner, portalAccessRuntime, settingsSource, previewRoot, encryptedRoot] = await Promise.all([
    read("worker/index.ts"),
    read("worker/operations-http-entry.ts"),
    read("worker/integration-audit-http.ts"),
    read("worker/portal-access-runtime.ts"),
    read("worker/settings-source-safe-entry.ts"),
    read("worker/backup-import-preview-root-entry.ts"),
    read("worker/backup-encrypted-root-entry.ts"),
  ]);

  for (const [path, source] of [
    ["worker/index.ts", workerIndex],
    ["worker/operations-http-entry.ts", operationsOwner],
    ["worker/integration-audit-http.ts", auditOwner],
    ["worker/portal-access-runtime.ts", portalAccessRuntime],
    ["worker/settings-source-safe-entry.ts", settingsSource],
  ]) {
    assert.doesNotMatch(source, /const\s+rolePermissions\s*:/, `${path} must not own a second built-in role map`);
    assert.doesNotMatch(source, /type\s+PortalPermission\s*=\s*"/, `${path} must import the canonical permission vocabulary`);
  }

  assert.doesNotMatch(workerIndex, /from ["']\.\/portal-access-runtime\.ts["']/, "central compatibility tail must not retain route access ownership");
  assert.match(operationsOwner, /from ["']\.\/portal-access-runtime\.ts["']/, "operations owner must delegate access resolution to the shared portal access runtime");
  assert.match(auditOwner, /from ["']\.\/portal-access-runtime\.ts["']/, "integration audit owner must delegate access resolution to the shared portal access runtime");
  assert.match(portalAccessRuntime, /from ["']\.\.\/src\/auth\/portal-permissions\.ts["']/, "shared portal access runtime must consume the canonical permission registry");
  assert.match(portalAccessRuntime, /portalRolePermissions/);
  assert.match(portalAccessRuntime, /resolvePortalRole/);
  assert.match(settingsSource, /portalRolePermissions|roleHasPermission/, "settings source must consume canonical permission helpers");

  assert.match(previewRoot, /resolvePortalRole/);
  assert.match(previewRoot, /roleHasPermission\(role, "backup\.restore\.preview"\)/);
  assert.match(encryptedRoot, /resolvePortalRole/);
  assert.match(encryptedRoot, /roleHasPermission\(access\.role, requiredPermission\)/);
});
