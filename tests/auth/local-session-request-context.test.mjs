import assert from "node:assert/strict";
import test from "node:test";

import { localSessionRequestContext } from "../../src/auth/local-session-request-context.ts";
import { portalRolePermissions } from "../../src/auth/portal-permissions.ts";

test("adapts an authenticated local session into the canonical request context", () => {
  const context = localSessionRequestContext({
    identity: " Admin@Example.COM ",
    role: "admin",
  });

  assert.equal(context.identity, "admin@example.com");
  assert.equal(context.role, "admin");
  assert.equal(context.authMode, "local-session");
  assert.deepEqual(context.groups, []);
  assert.deepEqual(context.permissions, portalRolePermissions.admin);
  assert.match(context.correlationId, /^cor_[a-f0-9]{32}$/u);
  assert.equal(Object.isFrozen(context), true);
});

test("keeps local session role permissions constrained by the canonical registry", () => {
  const context = localSessionRequestContext({
    identity: "operator@example.com",
    role: "operator",
  });

  assert.deepEqual(context.permissions, portalRolePermissions.operator);
  assert.equal(context.permissions.includes("settings.manage"), false);
});
