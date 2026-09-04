import test from "node:test";
import assert from "node:assert/strict";
import { handleEncryptedBackupRoute } from "../worker/backup-encrypted-root-entry.ts";
import { portalPermissionOrder, portalRolePermissions } from "../src/auth/portal-permissions.ts";

const request = (path) => new Request(`https://portal.test${path}`, { method: "POST", headers: { origin: "https://portal.test" }, body: "{}" });

test("viewer and operator are denied before encrypted handlers", async () => {
  for (const role of ["viewer", "operator"]) {
    let called = false;
    const response = await handleEncryptedBackupRoute(request("/api/admin/backups/export/encrypted"), { PORTAL_DEFAULT_ROLE: role }, {
      async exportHandler() { called = true; return new Response("ok"); },
    });
    assert.equal(response.status, 403);
    assert.equal(called, false);
    assert.equal((await response.json()).requiredPermission, "backup.export.encrypted");
  }
});

test("admin dispatches export and preview routes only", async () => {
  const calls = [];
  const dependencies = {
    async exportHandler() { calls.push("export"); return new Response("export"); },
    async previewHandler() { calls.push("preview"); return new Response("preview"); },
  };
  assert.equal((await handleEncryptedBackupRoute(request("/api/admin/backups/export/encrypted"), { PORTAL_DEFAULT_ROLE: "admin" }, dependencies)).status, 200);
  assert.equal((await handleEncryptedBackupRoute(request("/api/admin/backups/import/encrypted/preview"), { PORTAL_DEFAULT_ROLE: "admin" }, dependencies)).status, 200);
  assert.equal(await handleEncryptedBackupRoute(request("/api/other"), { PORTAL_DEFAULT_ROLE: "admin" }, dependencies), null);
  assert.deepEqual(calls, ["export", "preview"]);
});

test("encrypted export permission is admin only and represented in catalogue", () => {
  assert.equal(portalPermissionOrder.includes("backup.export.encrypted"), true);
  assert.equal(portalRolePermissions.viewer.includes("backup.export.encrypted"), false);
  assert.equal(portalRolePermissions.operator.includes("backup.export.encrypted"), false);
  assert.equal(portalRolePermissions.admin.includes("backup.export.encrypted"), true);
});
