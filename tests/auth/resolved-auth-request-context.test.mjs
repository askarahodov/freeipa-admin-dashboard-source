import assert from "node:assert/strict";
import test from "node:test";

import { resolvedAuthRequestContext } from "../../src/auth/resolved-auth-request-context.ts";
import { portalRolePermissions } from "../../src/auth/portal-permissions.ts";

for (const authMode of ["workspace", "proxy", "static", "service-admin"]) {
  test(`preserves the explicit ${authMode} authentication mechanism`, () => {
    const context = resolvedAuthRequestContext({
      identity: " Admin@Example.COM ",
      role: "admin",
      groups: [" Ops ", "ops", "Platform"],
      authMode,
    });

    assert.equal(context.identity, "admin@example.com");
    assert.equal(context.role, "admin");
    assert.equal(context.authMode, authMode);
    assert.deepEqual(context.groups, ["ops", "platform"]);
    assert.deepEqual(context.permissions, portalRolePermissions.admin);
    assert.match(context.correlationId, /^cor_[a-f0-9]{32}$/u);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.groups), true);
    assert.equal(Object.isFrozen(context.permissions), true);
  });
}

test("keeps mechanism context permissions constrained by the canonical role grant", () => {
  const context = resolvedAuthRequestContext({
    identity: "operator@example.com",
    role: "operator",
    authMode: "proxy",
  });

  assert.deepEqual(context.permissions, portalRolePermissions.operator);
  assert.equal(context.permissions.includes("settings.manage"), false);
});
