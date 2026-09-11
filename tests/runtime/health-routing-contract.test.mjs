import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const application = fs.readFileSync(new URL("../../worker/application.ts", import.meta.url), "utf8");
const healthHttp = fs.readFileSync(new URL("../../worker/health-http.ts", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../../scripts/freeipa-gateway.mjs", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

test("health remains outside ordinary schema and security gates while application owns dispatch", () => {
  assert.equal(schemaEntry.includes('import { isPreSchemaHealthApplicationRequest } from "./health-http.ts"'), true);
  assert.equal(schemaEntry.includes("if (isPreSchemaHealthApplicationRequest(request))"), true);
  assert.equal(schemaEntry.includes('import { handleHealthRequest } from "./health-contracts.ts"'), false);

  const bypassIndex = schemaEntry.indexOf("if (isPreSchemaHealthApplicationRequest(request))");
  assert.ok(bypassIndex >= 0);
  assert.ok(bypassIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(bypassIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));
  assert.ok(bypassIndex < schemaEntry.indexOf("await portalSchema(sourceEnv)"));

  assert.equal(application.includes('import { handleHealthApplicationRoute } from "./health-http.ts"'), true);
  assert.equal(application.includes("handleHealthApplicationRoute(request, env, route)"), true);
  assert.equal(healthHttp.includes('import { handleHealthRequest } from "./health-contracts.ts"'), true);
  assert.equal(healthHttp.includes("stableHealthRouteIds"), true);
});

test("Gateway exposes an authenticated local health route", () => {
  assert.equal(gateway.includes('request.method === "GET" && request.url === "/health"'), true);
  assert.equal(gateway.includes('gateway_authorization_required'), true);
  assert.equal(gateway.includes('gateway_ready'), true);
});

test("Docker liveness uses the dedicated live endpoint", () => {
  assert.equal(dockerfile.includes("fetch('http://127.0.0.1:3001/health/live')"), true);
  assert.equal(dockerfile.includes("fetch('http://127.0.0.1:3001/api/integrations/health')"), false);
});
