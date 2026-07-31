import assert from "node:assert/strict";
import test from "node:test";

import { backupPreviewAccess, handleBackupImportPreviewRoute } from "../worker/backup-import-preview-root-entry.ts";

const request = (path = "/api/admin/backups/import/preview", headers = {}) => new Request(`https://dashboard.test${path}`, {
  method: "POST",
  headers,
  body: "{}",
});

test("grants backup.restore.preview only to admin role", () => {
  assert.deepEqual(backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "admin" }).permissions, ["backup.restore.preview"]);
  assert.deepEqual(backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "operator" }).permissions, []);
  assert.deepEqual(backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "viewer" }).permissions, []);
});

test("resolves exact, wildcard and service-admin identities without privilege escalation", () => {
  const exact = backupPreviewAccess(request("/", { "oai-authenticated-user-email": "User@Example.Test" }), {
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "*": "operator", "user@example.test": "admin" }),
  });
  assert.equal(exact.role, "admin");

  const serviceAdmin = backupPreviewAccess(request(), {
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "service-admin@portal.local",
    PORTAL_DEFAULT_ROLE: "admin",
  });
  assert.equal(serviceAdmin.identity, "service-admin@portal.local");
  assert.deepEqual(serviceAdmin.permissions, ["backup.restore.preview"]);

  const malformed = backupPreviewAccess(request(), {
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: "{",
  });
  assert.equal(malformed.role, "viewer");
  assert.deepEqual(malformed.permissions, []);
});

test("blocks viewer and operator before invoking preview handler", async () => {
  let invoked = 0;
  for (const role of ["viewer", "operator"]) {
    const response = await handleBackupImportPreviewRoute(request(), { PORTAL_DEFAULT_ROLE: role }, {
      handler: async () => { invoked += 1; return new Response("preview"); },
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.requiredPermission, "backup.restore.preview");
    assert.equal(body.role, role);
  }
  assert.equal(invoked, 0);
});

test("invokes preview for admin and ignores every other path", async () => {
  let invoked = 0;
  const response = await handleBackupImportPreviewRoute(request(), { PORTAL_DEFAULT_ROLE: "admin" }, {
    handler: async (_request, _env, audit) => {
      invoked += 1;
      assert.equal(audit.actor.role, "admin");
      return new Response("preview", { status: 200 });
    },
    createContext: (actor) => ({ correlationId: "cor_test", actor }),
  });
  assert.equal(response.status, 200);
  assert.equal(invoked, 1);
  assert.equal(await handleBackupImportPreviewRoute(request("/api/other"), { PORTAL_DEFAULT_ROLE: "admin" }), null);
});
