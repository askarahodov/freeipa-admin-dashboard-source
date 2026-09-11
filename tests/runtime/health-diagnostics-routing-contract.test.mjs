import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const application = fs.readFileSync(new URL("../../worker/application.ts", import.meta.url), "utf8");
const healthHttp = fs.readFileSync(new URL("../../worker/health-http.ts", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

test("diagnostics UI keeps pre-schema reachability but dispatch moves to the application health owner", () => {
  assert.equal(schemaEntry.includes('import { handleHealthDiagnosticsRequest } from "./health-diagnostics-ui.ts"'), false);
  assert.equal(schemaEntry.includes("isPreSchemaHealthApplicationRequest(request)"), true);
  assert.equal(application.includes('import { handleHealthApplicationRoute } from "./health-http.ts"'), true);
  assert.equal(application.includes("supplemental: ({ request, env, ctx, route }) => healthOrCompatibility(request, env, ctx, route)"), true);
  assert.equal(healthHttp.includes('import { handleHealthDiagnosticsRequest } from "./health-diagnostics-ui.ts"'), true);

  const bypassIndex = schemaEntry.indexOf("if (isPreSchemaHealthApplicationRequest(request))");
  assert.ok(bypassIndex >= 0);
  assert.ok(bypassIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(bypassIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));

  const dependencyIndex = healthHttp.indexOf("const dependencyHealthResponse = await handleDependencyHealthRequest");
  const diagnosticsIndex = healthHttp.indexOf("const diagnosticsResponse = await handleHealthDiagnosticsRequest(request)");
  const metricsIndex = healthHttp.indexOf("return await handleHealthMetricsRequest");
  assert.ok(dependencyIndex >= 0 && diagnosticsIndex > dependencyIndex && metricsIndex > diagnosticsIndex);
});

test("diagnostics UI does not change container restart policy", () => {
  assert.equal(dockerfile.includes("fetch('http://127.0.0.1:3001/health/live')"), true);
  assert.equal(dockerfile.includes("/diagnostics/health"), false);
  assert.equal(dockerfile.includes("/health/dependencies"), false);
});
