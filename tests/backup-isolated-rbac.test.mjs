import test from "node:test";
import assert from "node:assert/strict";

import { handleEncryptedBackupRoute } from "../worker/backup-encrypted-root-entry.ts";
import {
  portalPermissionMetadata,
  portalPermissionOrder,
  portalRolePermissions,
} from "../src/auth/portal-permissions.ts";

const request = (path) => new Request(`https://portal.test${path}`, {
  method: "POST",
  headers: { origin: "https://portal.test" },
  body: "{}",
});

test("viewer and operator are denied before isolated restore handler", async () => {
  for (const role of ["viewer", "operator"]) {
    let called = false;
    const response = await handleEncryptedBackupRoute(
      request("/api/admin/backups/import/encrypted/test-restore"),
      { PORTAL_DEFAULT_ROLE: role },
      {
        async testRestoreHandler() {
          called = true;
          return new Response("must not run");
        },
      },
    );
    assert.equal(response.status, 403);
    assert.equal(called, false);
    assert.deepEqual(await response.json(), {
      error: "Insufficient permission for this operation",
      requiredPermission: "backup.restore.test",
      role,
    });
  }
});

test("admin dispatches export preview and test restore exactly once", async () => {
  const calls = [];
  const dependencies = {
    async exportHandler() { calls.push("export"); return new Response("export"); },
    async previewHandler() { calls.push("preview"); return new Response("preview"); },
    async testRestoreHandler() { calls.push("test-restore"); return new Response("test-restore"); },
  };

  assert.equal((await handleEncryptedBackupRoute(request("/api/admin/backups/export/encrypted"), { PORTAL_DEFAULT_ROLE: "admin" }, dependencies)).status, 200);
  assert.equal((await handleEncryptedBackupRoute(request("/api/admin/backups/import/encrypted/preview"), { PORTAL_DEFAULT_ROLE: "admin" }, dependencies)).status, 200);
  assert.equal((await handleEncryptedBackupRoute(request("/api/admin/backups/import/encrypted/test-restore"), { PORTAL_DEFAULT_ROLE: "admin" }, dependencies)).status, 200);
  assert.equal(await handleEncryptedBackupRoute(request("/api/other"), { PORTAL_DEFAULT_ROLE: "admin" }, dependencies), null);
  assert.deepEqual(calls, ["export", "preview", "test-restore"]);
});

test("backup.restore.test is admin-only and has safe browser metadata", () => {
  assert.equal(portalPermissionOrder.includes("backup.restore.test"), true);
  assert.equal(portalRolePermissions.viewer.includes("backup.restore.test"), false);
  assert.equal(portalRolePermissions.operator.includes("backup.restore.test"), false);
  assert.equal(portalRolePermissions.admin.includes("backup.restore.test"), true);
  const metadata = portalPermissionMetadata["backup.restore.test"];
  assert.ok(metadata.title.length > 3);
  assert.ok(metadata.description.length > 10);
  assert.equal(metadata.scope, "Portal");
  assert.doesNotMatch(JSON.stringify(metadata), /password|token|secret|key|hash/i);
});
