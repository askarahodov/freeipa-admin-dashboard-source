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
    if (route.requiredRole !== undefined) assert.equal(route.requiredRole, "admin", route.id);
  }
});

test("portal route contract preserves static security boundaries", () => {
  for (const route of portalRouteContracts) {
    assert.ok(allowedAuth.has(route.auth), route.id);
    assert.ok(route.mutation === "read" || route.mutation === "mutation", route.id);
    if (route.mutation === "read") assert.equal(route.sameOrigin, false, route.id);
    if (route.sameOrigin) assert.equal(route.mutation, "mutation", route.id);
    if (route.permission) assert.ok(canonicalPermissions.has(route.permission), route.id);
    for (const permission of route.conditionalPermissions ?? []) {
      assert.ok(canonicalPermissions.has(permission), `${route.id}: ${permission}`);
    }
    if (route.auth === "service-admin") {
      assert.equal(route.permission, undefined, route.id);
      assert.deepEqual(route.conditionalPermissions ?? [], [], route.id);
    }
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

  for (const route of portalRouteContracts.filter((route) => route.path.startsWith("/api/auth/"))) {
    assert.equal(route.sameOrigin, false, `${route.id}: current auth API dispatch precedes the shared admin same-origin gate`);
  }
});

test("settings lifecycle inventory preserves admin delegation, permission and origin gates", () => {
  const expected = [
    ["GET", "/api/integrations/settings", false],
    ["PUT", "/api/integrations/settings", true],
    ["POST", "/api/integrations/settings/test", true],
    ["GET", "/api/integrations/settings/effective", false],
    ["POST", "/api/integrations/settings/drafts", true],
    ["GET", "/api/integrations/settings/drafts/:draftId", false],
    ["POST", "/api/integrations/settings/drafts/:draftId/validate", true],
    ["POST", "/api/integrations/settings/drafts/:draftId/apply", true],
    ["POST", "/api/integrations/settings/drafts/:draftId/cancel", true],
    ["GET", "/api/integrations/settings/revisions", false],
    ["GET", "/api/integrations/settings/revisions/:revision", false],
  ];

  for (const [method, path, sameOrigin] of expected) {
    const route = findPortalRouteContract(method, path);
    assert.ok(route, `${method} ${path}`);
    assert.equal(route.auth, "admin-or-service-admin", route.id);
    assert.equal(route.permission, "settings.manage", route.id);
    assert.equal(route.sameOrigin, sameOrigin, route.id);
  }
});

test("FreeIPA inventory keeps read/write/delete capabilities distinct", () => {
  for (const [method, path] of [
    ["GET", "/api/integrations/users"],
    ["GET", "/api/integrations/users/export.csv"],
    ["GET", "/api/integrations/groups"],
    ["GET", "/api/integrations/groups/members"],
  ]) {
    const route = findPortalRouteContract(method, path);
    assert.ok(route, `${method} ${path}`);
    assert.equal(route.auth, "local-session", route.id);
    assert.equal(route.permission, "directory.read", route.id);
  }

  const actions = findPortalRouteContract("POST", "/api/integrations/freeipa/actions");
  assert.equal(actions?.auth, "local-session");
  assert.equal(actions?.permission, "freeipa.write");
  assert.deepEqual(actions?.conditionalPermissions, ["freeipa.delete"]);
  assert.equal(actions?.sameOrigin, false);

  const bulk = findPortalRouteContract("POST", "/api/integrations/freeipa/bulk");
  assert.equal(bulk?.auth, "local-session");
  assert.equal(bulk?.permission, "freeipa.write");
  assert.deepEqual(bulk?.conditionalPermissions ?? [], []);
});

test("XYOps, approvals and run inventory preserves explicit capability checks", () => {
  for (const path of [
    "/api/integrations/approvals",
    "/api/integrations/notifications",
    "/api/integrations/runs/:runId/files/:fileId",
  ]) {
    const route = findPortalRouteContract("GET", path);
    assert.equal(route?.auth, "local-session", path);
    assert.equal(route?.permission, "directory.read", path);
  }
  assert.equal(findPortalRouteContract("POST", "/api/integrations/notifications/read")?.permission, "directory.read");

  for (const action of ["approve", "reject"]) {
    const route = findPortalRouteContract("POST", `/api/integrations/approvals/:approvalId/${action}`);
    assert.equal(route?.permission, "xyops.approve", action);
  }
  for (const action of ["cancel", "execute"]) {
    const route = findPortalRouteContract("POST", `/api/integrations/approvals/:approvalId/${action}`);
    assert.equal(route?.permission, "xyops.run", action);
  }
  for (const action of ["cancel", "rerun"]) {
    const route = findPortalRouteContract("POST", `/api/integrations/runs/:runId/${action}`);
    assert.equal(route?.permission, "xyops.run", action);
  }

  assert.equal(findPortalRouteContract("POST", "/api/integrations/catalog/run")?.permission, "xyops.run");
  for (const path of [
    "/api/integrations/catalog",
    "/api/integrations/catalog/history",
    "/api/integrations/catalog/options",
    "/api/integrations/runs",
  ]) {
    const route = findPortalRouteContract("GET", path);
    assert.equal(route?.auth, "local-session", path);
    assert.equal(route?.permission, undefined, path);
  }
});

test("XYOps administration routes stay distinct from HTTP registry metadata", () => {
  for (const path of [
    "/api/integrations/routes",
    "/api/integrations/catalog/presentation",
    "/api/integrations/catalog/policies",
    "/api/integrations/approval/policies",
  ]) {
    const read = findPortalRouteContract("GET", path);
    const write = findPortalRouteContract("PUT", path);
    assert.equal(read?.auth, "admin-or-service-admin", path);
    assert.equal(read?.permission, "settings.manage", path);
    assert.equal(read?.sameOrigin, false, path);
    assert.equal(write?.auth, "admin-or-service-admin", path);
    assert.equal(write?.permission, "settings.manage", path);
    assert.equal(write?.sameOrigin, true, path);
  }

  const syncRead = findPortalRouteContract("GET", "/api/integrations/catalog/sync");
  const syncRun = findPortalRouteContract("POST", "/api/integrations/catalog/sync");
  assert.equal(syncRead?.auth, "admin-or-service-admin");
  assert.equal(syncRead?.requiredRole, "admin");
  assert.equal(syncRead?.permission, undefined);
  assert.equal(syncRun?.auth, "admin-or-service-admin");
  assert.equal(syncRun?.requiredRole, "admin");
  assert.equal(syncRun?.sameOrigin, true);
});
