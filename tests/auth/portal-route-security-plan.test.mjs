import assert from "node:assert/strict";
import test from "node:test";

import { matchPortalRoute } from "../../src/auth/portal-route-router.ts";
import { portalRouteSecurityPlan } from "../../src/auth/portal-route-security-plan.ts";

function plan(method, pathname) {
  const match = matchPortalRoute(method, pathname);
  assert.ok(match, `expected canonical route match for ${method} ${pathname}`);
  return portalRouteSecurityPlan(match.contract);
}

test("public routes keep request context without inventing authentication middleware", () => {
  const security = plan("POST", "/api/auth/login");

  assert.equal(security.routeId, "auth.login");
  assert.equal(security.auth, "public");
  assert.deepEqual(security.stages, ["request-context"]);
  assert.equal(security.sameOrigin, false);
});

test("local admin mutations preserve authentication, authorization and same-origin order", () => {
  const security = plan("POST", "/api/auth/users");

  assert.equal(security.auth, "admin-session");
  assert.deepEqual(security.stages, [
    "request-context",
    "authentication",
    "authorization",
    "same-origin",
  ]);
  assert.equal(security.mutation, "mutation");
});

test("service-admin reads require auth without cookie same-origin semantics", () => {
  const security = plan("GET", "/api/schema/status");

  assert.equal(security.auth, "service-admin");
  assert.deepEqual(security.stages, ["request-context", "authentication", "authorization"]);
  assert.equal(security.sameOrigin, false);
});

test("admin-or-service-admin mutations retain permission and role metadata", () => {
  const security = plan("POST", "/api/integrations/catalog/sync");

  assert.equal(security.auth, "admin-or-service-admin");
  assert.equal(security.requiredRole, "admin");
  assert.deepEqual(security.stages, [
    "request-context",
    "authentication",
    "authorization",
    "same-origin",
  ]);
});

test("conditional permissions are copied into an immutable plan", () => {
  const security = plan("POST", "/api/integrations/freeipa/actions");

  assert.equal(security.permission, "freeipa.write");
  assert.deepEqual(security.conditionalPermissions, ["freeipa.delete"]);
  assert.equal(Object.isFrozen(security), true);
  assert.equal(Object.isFrozen(security.stages), true);
  assert.equal(Object.isFrozen(security.conditionalPermissions), true);
  assert.throws(() => security.conditionalPermissions.push("settings.manage"), TypeError);
});
