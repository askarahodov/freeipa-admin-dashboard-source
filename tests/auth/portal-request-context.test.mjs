import assert from "node:assert/strict";
import test from "node:test";

import { createPortalRequestContext } from "../../src/auth/portal-request-context.ts";
import { portalRolePermissions } from "../../src/auth/portal-permissions.ts";

test("packages an already-resolved principal into one immutable request context", () => {
  const sourceGroups = [" Operators ", "operators", "TEAM-A"];
  const context = createPortalRequestContext({
    correlationId: "req-123",
    identity: " Admin@Example.COM ",
    role: "admin",
    groups: sourceGroups,
    authMode: "local-session",
  });

  sourceGroups.push("late-group");

  assert.deepEqual(context, {
    correlationId: "req-123",
    identity: "admin@example.com",
    role: "admin",
    groups: ["operators", "team-a"],
    permissions: portalRolePermissions.admin,
    authMode: "local-session",
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.groups), true);
  assert.equal(Object.isFrozen(context.permissions), true);
});

test("keeps authentication mechanism explicit instead of inferring trust from identity", () => {
  const local = createPortalRequestContext({ correlationId: "local-1", identity: "admin@example.com", role: "admin", authMode: "local-session" });
  const service = createPortalRequestContext({ correlationId: "service-1", identity: "service-admin", role: "admin", authMode: "service-admin" });

  assert.equal(local.authMode, "local-session");
  assert.equal(service.authMode, "service-admin");
  assert.deepEqual(local.permissions, portalRolePermissions.admin);
  assert.deepEqual(service.permissions, portalRolePermissions.admin);
});

test("supports explicit narrowed permissions without mutating the role registry", () => {
  const requested = ["directory.read", "xyops.run", "directory.read"];
  const context = createPortalRequestContext({
    correlationId: "proxy-1",
    identity: "operator@example.com",
    role: "operator",
    groups: [],
    permissions: requested,
    authMode: "proxy",
  });

  assert.deepEqual(context.permissions, ["directory.read", "xyops.run"]);
  assert.notStrictEqual(context.permissions, requested);
  assert.deepEqual(portalRolePermissions.operator, ["directory.read", "freeipa.write", "xyops.run"]);
});

test("rejects malformed identity or correlation metadata before it enters shared context", () => {
  assert.throws(
    () => createPortalRequestContext({ correlationId: "bad\nvalue", identity: "user@example.com", role: "viewer", authMode: "static" }),
    /correlation id is invalid/u,
  );
  assert.throws(
    () => createPortalRequestContext({ correlationId: "req-2", identity: "bad\ridentity", role: "viewer", authMode: "static" }),
    /identity is invalid/u,
  );
});
