import assert from "node:assert/strict";
import test from "node:test";

import { matchPortalRoute } from "../../src/auth/portal-route-router.ts";

test("matches exact canonical routes without changing metadata", () => {
  const match = matchPortalRoute("POST", "/api/auth/login");
  assert.ok(match);
  assert.equal(match.contract.id, "auth.login");
  assert.equal(match.contract.auth, "public");
  assert.equal(match.contract.mutation, "mutation");
  assert.deepEqual(match.params, {});
});

test("matches parameterized routes and exposes only named path parameters", () => {
  const match = matchPortalRoute("POST", "/api/integrations/runs/run-42/cancel");
  assert.ok(match);
  assert.equal(match.contract.id, "xyops.runs.cancel");
  assert.deepEqual(match.params, { runId: "run-42" });
});

test("prefers the more specific static route over a compatible dynamic shape", () => {
  const match = matchPortalRoute("GET", "/api/integrations/catalog/history");
  assert.ok(match);
  assert.equal(match.contract.id, "xyops.catalog.history");
  assert.deepEqual(match.params, {});
});

test("method remains part of the route contract", () => {
  assert.equal(matchPortalRoute("GET", "/api/auth/login"), undefined);
  assert.equal(matchPortalRoute("POST", "/api/auth/session"), undefined);
});

test("rejects query fragments and unknown route shapes instead of normalizing them", () => {
  assert.equal(matchPortalRoute("GET", "/api/auth/session?debug=1"), undefined);
  assert.equal(matchPortalRoute("GET", "/api/auth/session#debug"), undefined);
  assert.equal(matchPortalRoute("GET", "/api/not-a-real-route"), undefined);
});

test("returns immutable match metadata", () => {
  const match = matchPortalRoute("DELETE", "/api/auth/users/user-1/sessions");
  assert.ok(match);
  assert.equal(match.contract.id, "auth.users.sessions-revoke");
  assert.deepEqual(match.params, { userId: "user-1" });
  assert.equal(Object.isFrozen(match), true);
  assert.equal(Object.isFrozen(match.params), true);
});
