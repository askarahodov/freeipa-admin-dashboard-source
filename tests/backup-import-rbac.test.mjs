import assert from "node:assert/strict";
import test from "node:test";

import { backupPreviewAccess, createBackupImportPreviewRuntime } from "../worker/backup-import-preview-root-entry.ts";

const request = (headers = {}) => new Request("https://dashboard.test/api/admin/backups/import/preview", {
  method: "POST",
  headers,
  body: "{}",
});

const context = { waitUntil() {}, passThroughOnException() {} };

test("grants backup.restore.preview only to admin role", () => {
  assert.deepEqual(backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "admin" }).permissions, ["backup.restore.preview"]);
  assert.deepEqual(backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "operator" }).permissions, []);
  assert.deepEqual(backupPreviewAccess(request(), { PORTAL_DEFAULT_ROLE: "viewer" }).permissions, []);
});

test("resolves exact identity and wildcard RBAC assignments without privilege escalation", () => {
  const exact = backupPreviewAccess(request({ "oai-authenticated-user-email": "User@Example.Test" }), {
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "*": "operator", "user@example.test": "admin" }),
  });
  assert.equal(exact.role, "admin");
  assert.deepEqual(exact.permissions, ["backup.restore.preview"]);

  const malformed = backupPreviewAccess(request(), {
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: "{",
  });
  assert.equal(malformed.role, "viewer");
  assert.deepEqual(malformed.permissions, []);
});

test("blocks viewer and operator before invoking preview handler", async () => {
  let invoked = 0;
  let delegated = 0;
  const runtime = createBackupImportPreviewRuntime({
    async fetch() { delegated += 1; return new Response("delegated"); },
    async scheduled() {},
  }, async () => { invoked += 1; return new Response("preview"); });

  for (const role of ["viewer", "operator"]) {
    const response = await runtime.fetch(request(), { PORTAL_DEFAULT_ROLE: role }, context);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.requiredPermission, "backup.restore.preview");
    assert.equal(body.role, role);
  }
  assert.equal(invoked, 0);
  assert.equal(delegated, 0);
});

test("invokes preview only for admin and delegates every other path", async () => {
  let invoked = 0;
  let delegated = 0;
  const runtime = createBackupImportPreviewRuntime({
    async fetch() { delegated += 1; return new Response("delegated"); },
    async scheduled() {},
  }, async (_request, _env, audit) => {
    invoked += 1;
    assert.equal(audit.actor.role, "admin");
    return new Response("preview", { status: 200 });
  });

  const preview = await runtime.fetch(request(), { PORTAL_DEFAULT_ROLE: "admin" }, context);
  assert.equal(preview.status, 200);
  assert.equal(invoked, 1);

  const other = await runtime.fetch(new Request("https://dashboard.test/api/other"), { PORTAL_DEFAULT_ROLE: "admin" }, context);
  assert.equal(await other.text(), "delegated");
  assert.equal(delegated, 1);
});
