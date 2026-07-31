import assert from "node:assert/strict";
import test from "node:test";

import {
  portalPermissionMetadata,
  portalPermissionOrder,
  portalRolePermissions,
} from "../portal-permissions.ts";
import { handleEncryptedBackupRoute } from "../worker/backup-encrypted-root-entry.ts";

const paths = [
  ["/api/admin/backups/import/encrypted/prepare-commit", "backup.restore.prepare", "prepareHandler"],
  ["/api/admin/backups/import/encrypted/commit", "backup.restore.commit", "commitHandler"],
  ["/api/admin/backups/import/encrypted/cancel", "backup.restore.cancel", "cancelHandler"],
];

function request(path) {
  return new Request(`https://portal.example${path}`, {
    method: "POST",
    headers: { origin: "https://portal.example" },
    body: "{}",
  });
}

test("selective restore permissions are admin-only and have safe metadata", () => {
  for (const permission of [
    "backup.restore.prepare",
    "backup.restore.commit",
    "backup.restore.cancel",
  ]) {
    assert.equal(portalPermissionOrder.includes(permission), true);
    assert.equal(portalRolePermissions.viewer.includes(permission), false);
    assert.equal(portalRolePermissions.operator.includes(permission), false);
    assert.equal(portalRolePermissions.admin.includes(permission), true);
    assert.equal(typeof portalPermissionMetadata[permission].title, "string");
    assert.equal(typeof portalPermissionMetadata[permission].description, "string");
    assert.equal(portalPermissionMetadata[permission].scope, "Portal");
  }
});

test("viewer and operator are denied before selective restore handlers", async () => {
  for (const role of ["viewer", "operator"]) {
    for (const [path, permission] of paths) {
      let calls = 0;
      const handler = async () => { calls += 1; return new Response("unexpected"); };
      const response = await handleEncryptedBackupRoute(
        request(path),
        { PORTAL_DEFAULT_ROLE: role },
        {
          prepareHandler: handler,
          commitHandler: handler,
          cancelHandler: handler,
        },
      );
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "Insufficient permission for this operation",
        requiredPermission: permission,
        role,
      });
      assert.equal(calls, 0);
    }
  }
});

test("admin dispatches each selective restore route exactly once", async () => {
  for (const [path, , dependencyName] of paths) {
    const calls = [];
    const dependencies = {
      prepareHandler: async (...args) => { calls.push(["prepare", ...args]); return new Response("prepare"); },
      commitHandler: async (...args) => { calls.push(["commit", ...args]); return new Response("commit"); },
      cancelHandler: async (...args) => { calls.push(["cancel", ...args]); return new Response("cancel"); },
      createContext: (access) => ({ correlationId: "cor_11111111111111111111", actor: access }),
    };
    const response = await handleEncryptedBackupRoute(
      request(path),
      { PORTAL_DEFAULT_ROLE: "admin" },
      dependencies,
    );
    assert.equal(await response.text(), dependencyName.replace("Handler", ""));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], dependencyName.replace("Handler", ""));
    assert.equal(calls[0][1] instanceof Request, true);
    assert.equal(calls[0][3].actor.role, "admin");
  }
});
