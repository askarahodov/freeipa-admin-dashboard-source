import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { portalRouteContracts } from "../../src/auth/portal-route-contract.ts";
import { handleIntegrationAuditRequest } from "../../worker/integration-audit-http.ts";

const auditPath = "https://portal.test/api/integrations/audit";

test("integration audit route has one explicit canonical owner", () => {
  const route = portalRouteContracts.find((item) => item.id === "integration.audit");
  assert.ok(route);
  assert.equal(route.method, "GET");
  assert.equal(route.path, "/api/integrations/audit");
  assert.equal(route.owner, "worker/integration-audit-http.ts");
  assert.equal(route.auth, "admin-or-service-admin");
  assert.equal(route.permission, "settings.manage");
  assert.equal(route.mutation, "read");
  assert.equal(route.sameOrigin, false);
});

test("integration audit preserves permission-before-method behavior", async () => {
  const viewer = await handleIntegrationAuditRequest(
    new Request(auditPath, { method: "POST" }),
    { PORTAL_DEFAULT_ROLE: "viewer" },
  );
  assert.ok(viewer);
  assert.equal(viewer.status, 403);
  assert.equal((await viewer.json()).requiredPermission, "settings.manage");

  const admin = await handleIntegrationAuditRequest(
    new Request(auditPath, { method: "POST" }),
    { PORTAL_DEFAULT_ROLE: "admin" },
  );
  assert.ok(admin);
  assert.equal(admin.status, 405);
  assert.deepEqual(await admin.json(), { error: "Method not allowed" });
});

test("integration audit keeps bounded no-persistence response and unrelated fallthrough", async () => {
  const response = await handleIntegrationAuditRequest(
    new Request(auditPath, { method: "GET" }),
    { PORTAL_DEFAULT_ROLE: "admin" },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { events: [], persistenceAvailable: false });

  const unrelated = await handleIntegrationAuditRequest(
    new Request("https://portal.test/api/integrations/status", { method: "GET" }),
    { PORTAL_DEFAULT_ROLE: "admin" },
  );
  assert.equal(unrelated, null);
});

test("central compatibility tail no longer dispatches integration HTTP routes", () => {
  const central = fs.readFileSync(new URL("../../worker/index.ts", import.meta.url), "utf8");
  const operations = fs.readFileSync(new URL("../../worker/operations-http-entry.ts", import.meta.url), "utf8");

  assert.equal(central.includes("/api/integrations/audit"), false);
  assert.equal(central.includes('pathname.startsWith("/api/integrations/")'), false);
  assert.equal(central.includes("handleIntegrationApi"), false);
  assert.equal(operations.includes('from "./integration-audit-http.ts"'), true);
  assert.equal(operations.includes("handleIntegrationAuditRequest(request, sourceEnv)"), true);
});
