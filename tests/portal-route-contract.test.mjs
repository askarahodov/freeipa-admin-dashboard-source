import assert from "node:assert/strict";
import test from "node:test";

import { portalPermissionOrder } from "../portal-permissions.ts";
import {
  findPortalRouteContract,
  portalRouteContracts,
} from "../portal-route-contract.ts";

const allowedMethods = new Set(["GET", "POST", "PUT", "DELETE"]);
const allowedAuth = new Set([
  "public",
  "local-session",
  "admin-session",
  "service-admin",
  "admin-or-service-admin",
]);
const canonicalPermissions = new Set(portalPermissionOrder);

test("portal route contract has unique stable identifiers and method/path pairs", () => {
  assert.ok(portalRouteContracts.length > 0);
  assert.equal(new Set(portalRouteContracts.map((route) => route.id)).size, portalRouteContracts.length);
  assert.equal(
    new Set(portalRouteContracts.map((route) => `${route.method} ${route.path}`)).size,
    portalRouteContracts.length,
  );

  for (const route of portalRouteContracts) {
    assert.match(route.id, /^[a-z0-9.-]+$/, route.id);
    assert.ok(allowedMethods.has(route.method), route.id);
    assert.match(route.path, /^\//, route.id);
    assert.doesNotMatch(route.path, /\{[^}]+\}/, `${route.id}: dynamic segments use :name syntax`);
    assert.ok(route.owner.endsWith(".ts"), route.id);
  }
});

test("portal route contract preserves static security boundaries", () => {
  for (const route of portalRouteContracts) {
    assert.ok(allowedAuth.has(route.auth), route.id);
    assert.ok(route.mutation === "read" || route.mutation === "mutation", route.id);
    if (route.mutation === "read") assert.equal(route.sameOrigin, false, route.id);
    if (route.sameOrigin) assert.equal(route.mutation, "mutation", route.id);
    if (route.permission) assert.ok(canonicalPermissions.has(route.permission), route.id);
    if (route.auth === "service-admin") assert.equal(route.permission, undefined, route.id);
  }
});

test("route metadata lookup is exact and does not become a runtime matcher", () => {
  assert.equal(findPortalRouteContract("GET", "/health/live")?.id, "health.live");
  assert.equal(findPortalRouteContract("GET", "/api/auth/users/:userId"), undefined);
  assert.equal(findPortalRouteContract("GET", "/does-not-exist"), undefined);
});

test("local authentication and user administration routes match the current security boundary", () => {
  assert.equal(findPortalRouteContract("GET", "/api/auth/session")?.auth, "public");
  assert.equal(findPortalRouteContract("POST", "/api/auth/login")?.auth, "public");
  assert.equal(findPortalRouteContract("POST", "/api/auth/logout")?.auth, "local-session");

  assert.equal(findPortalRouteContract("GET", "/api/auth/users")?.auth, "admin-session");
  assert.equal(findPortalRouteContract("POST", "/api/auth/users")?.auth, "admin-session");
  assert.equal(findPortalRouteContract("PUT", "/api/auth/users/:userId")?.auth, "admin-session");
  assert.equal(findPortalRouteContract("DELETE", "/api/auth/users/:userId")?.auth, "admin-session");
  assert.equal(findPortalRouteContract("POST", "/api/auth/users/:userId/password")?.auth, "admin-session");
  assert.equal(findPortalRouteContract("DELETE", "/api/auth/users/:userId/sessions")?.auth, "admin-session");

  for (const route of portalRouteContracts.filter((route) => route.path.startsWith("/api/auth/users"))) {
    if (route.method !== "GET") {
      assert.equal(route.mutation, "mutation", route.id);
      assert.equal(route.sameOrigin, true, route.id);
    }
  }
});
