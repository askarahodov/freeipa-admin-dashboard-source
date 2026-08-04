import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

test("diagnostics UI dispatch precedes schema, maintenance and authentication gates", () => {
  assert.equal(schemaEntry.includes('import { handleHealthDiagnosticsRequest } from "./health-diagnostics-ui.ts"'), true);
  assert.equal(schemaEntry.includes("const diagnosticsResponse = await handleHealthDiagnosticsRequest(request)"), true);
  assert.equal(schemaEntry.includes("if (diagnosticsResponse) return diagnosticsResponse"), true);

  const healthIndex = schemaEntry.indexOf("const healthResponse = await handleHealthRequest");
  const dependencyIndex = schemaEntry.indexOf("const dependencyHealthResponse = await handleDependencyHealthRequest");
  const diagnosticsIndex = schemaEntry.indexOf("const diagnosticsResponse = await handleHealthDiagnosticsRequest(request)");
  assert.ok(diagnosticsIndex > dependencyIndex);
  assert.ok(dependencyIndex > healthIndex);
  assert.ok(diagnosticsIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(diagnosticsIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));
  assert.ok(diagnosticsIndex < schemaEntry.indexOf("await portalSchema(sourceEnv)"));
});

test("diagnostics UI does not change container restart policy", () => {
  assert.equal(dockerfile.includes("fetch('http://127.0.0.1:3001/health/live')"), true);
  assert.equal(dockerfile.includes("/diagnostics/health"), false);
  assert.equal(dockerfile.includes("/health/dependencies"), false);
});
