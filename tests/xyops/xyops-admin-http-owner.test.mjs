import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const adminHttp = read("../../worker/xyops-admin-http.ts");
const adminRuntime = read("../../worker/xyops-admin-runtime.ts");
const operations = read("../../worker/operations-http-entry.ts");
const centralUrl = new URL("../../worker/index.ts", import.meta.url);
const routeContract = read("../../src/auth/portal-route-contract.ts");

const ownedPaths = [
  "/api/integrations/routes",
  "/api/integrations/catalog/presentation",
  "/api/integrations/catalog/policies",
  "/api/integrations/approval/policies",
];

test("#635 C5/C8 gives XYOps administration one explicit owner before framework fallback", () => {
  assert.equal(operations.includes('from "./xyops-admin-http.ts"'), true);
  const adminDispatch = operations.indexOf("handleXyOpsAdminRequest(request, sourceEnv)");
  const frameworkFallback = operations.indexOf("handleFrameworkRequest(request, sourceEnv, ctx)");
  assert.ok(adminDispatch >= 0 && frameworkFallback > adminDispatch);
  assert.equal(fs.existsSync(centralUrl), false, "retired central Worker tail must stay absent");

  for (const path of ownedPaths) {
    assert.equal(adminHttp.includes(path), true, path);
  }
});

test("XYOps admin owner keeps security, audit and persistence boundaries explicit", () => {
  assert.equal(adminHttp.includes('requirePortalPermission(request, baseEnv, "settings.manage")'), true);
  assert.equal(adminHttp.includes("serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)"), true);
  assert.equal(adminHttp.includes('action: "routes.updated"'), true);
  assert.equal(adminHttp.includes('action: "catalog.presentation.updated"'), true);
  assert.equal(adminHttp.includes('action: "catalog.policy.updated"'), true);
  assert.equal(adminHttp.includes('action: "approval.policy.updated"'), true);
  assert.equal(adminRuntime.includes("encryptIntegrationSecrets as encryptSecrets"), true);
  assert.equal(adminRuntime.includes("decryptIntegrationSecrets as decryptSecrets"), true);
  assert.equal(adminRuntime.includes('from "./index"'), false);
  assert.equal(adminHttp.includes('from "./index"'), false);
});

test("canonical route metadata has no remaining worker/index.ts stable owner", () => {
  assert.equal(routeContract.includes('owner: "worker/index.ts"'), false);
  for (const id of [
    "xyops.routes.read",
    "xyops.routes.update",
    "xyops.presentation.read",
    "xyops.presentation.update",
    "xyops.catalog-policies.read",
    "xyops.catalog-policies.update",
    "xyops.approval-policies.read",
    "xyops.approval-policies.update",
  ]) {
    assert.match(routeContract, new RegExp(`id: "${id.replaceAll(".", "\\.")}".*owner: "worker\\/xyops-admin-http\\.ts"`));
  }
});
