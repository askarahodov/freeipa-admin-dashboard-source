import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const application = fs.readFileSync(new URL("../../worker/application.ts", import.meta.url), "utf8");
const healthHttp = fs.readFileSync(new URL("../../worker/health-http.ts", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

test("metrics keeps pre-schema reachability while explicit application health owner dispatches it", () => {
  assert.equal(schemaEntry.includes('import { handleHealthMetricsRequest } from "./health-metrics.ts"'), false);
  assert.equal(schemaEntry.includes("isPreSchemaHealthApplicationRequest(request)"), true);
  assert.equal(application.includes('import { handleHealthApplicationRoute } from "./health-http.ts"'), true);
  assert.equal(healthHttp.includes('import { handleHealthMetricsRequest } from "./health-metrics.ts"'), true);

  const bypassIndex = schemaEntry.indexOf("if (isPreSchemaHealthApplicationRequest(request))");
  assert.ok(bypassIndex >= 0);
  assert.ok(bypassIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(bypassIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));
  assert.ok(bypassIndex < schemaEntry.indexOf("await portalSchema(sourceEnv)"));
});

test("metrics scrape does not alter Docker restart policy or invoke dependency handler", () => {
  assert.equal(dockerfile.includes("fetch('http://127.0.0.1:3001/health/live')"), true);
  assert.equal(dockerfile.includes("/metrics/health"), false);

  const metricsStart = healthHttp.indexOf("return await handleHealthMetricsRequest");
  assert.ok(metricsStart >= 0);
  const metricsBlock = healthHttp.slice(metricsStart);
  assert.equal(metricsBlock.includes("handleDependencyHealthRequest"), false);
  assert.equal(metricsBlock.includes("/health/dependencies"), false);
  assert.equal(metricsBlock.includes("canonicalHealthResponse(healthRequest, env)"), true);
});
