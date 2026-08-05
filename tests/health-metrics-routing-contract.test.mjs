import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

test("metrics dispatch precedes ordinary schema, maintenance and authentication gates", () => {
  assert.equal(schemaEntry.includes('import { handleHealthMetricsRequest } from "./health-metrics.ts"'), true);
  assert.equal(schemaEntry.includes("const metricsResponse = await handleHealthMetricsRequest"), true);
  assert.equal(schemaEntry.includes("if (metricsResponse) return metricsResponse"), true);

  const diagnosticsIndex = schemaEntry.indexOf("const diagnosticsResponse = await handleHealthDiagnosticsRequest(request)");
  const metricsIndex = schemaEntry.indexOf("const metricsResponse = await handleHealthMetricsRequest");
  assert.ok(metricsIndex > diagnosticsIndex);
  assert.ok(metricsIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(metricsIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));
  assert.ok(metricsIndex < schemaEntry.indexOf("await portalSchema(sourceEnv)"));
});

test("metrics scrape does not alter Docker restart policy or invoke dependency handler", () => {
  assert.equal(dockerfile.includes("fetch('http://127.0.0.1:3001/health/live')"), true);
  assert.equal(dockerfile.includes("/metrics/health"), false);
  assert.equal(schemaEntry.includes("handleDependencyHealthRequest(request, sourceEnv"), true);

  const metricsStart = schemaEntry.indexOf("const metricsResponse = await handleHealthMetricsRequest");
  const metricsEnd = schemaEntry.indexOf("if (metricsResponse) return metricsResponse", metricsStart);
  const metricsBlock = schemaEntry.slice(metricsStart, metricsEnd);
  assert.equal(metricsBlock.includes("handleDependencyHealthRequest"), false);
  assert.equal(metricsBlock.includes("/health/dependencies"), false);
});
