import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const application = fs.readFileSync(new URL("../../worker/application.ts", import.meta.url), "utf8");
const healthHttp = fs.readFileSync(new URL("../../worker/health-http.ts", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../../scripts/freeipa-gateway.mjs", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

test("dependency health stays pre-schema while application health owner owns dispatch", () => {
  assert.equal(schemaEntry.includes('import { handleDependencyHealthRequest } from "./dependency-health.ts"'), false);
  assert.equal(schemaEntry.includes("if (isPreSchemaHealthApplicationRequest(request))"), true);
  assert.equal(application.includes('import { handleHealthApplicationRoute } from "./health-http.ts"'), true);
  assert.equal(healthHttp.includes('import { handleDependencyHealthRequest } from "./dependency-health.ts"'), true);
  assert.equal(healthHttp.includes("const dependencyHealthResponse = await handleDependencyHealthRequest"), true);
  assert.equal(healthHttp.includes("if (dependencyHealthResponse) return dependencyHealthResponse"), true);

  const bypassIndex = schemaEntry.indexOf("if (isPreSchemaHealthApplicationRequest(request))");
  assert.ok(bypassIndex >= 0);
  assert.ok(bypassIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(bypassIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));

  const stableIndex = healthHttp.indexOf("const healthResponse = await canonicalHealthResponse");
  const dependencyIndex = healthHttp.indexOf("const dependencyHealthResponse = await handleDependencyHealthRequest");
  const diagnosticsIndex = healthHttp.indexOf("const diagnosticsResponse = await handleHealthDiagnosticsRequest");
  assert.ok(stableIndex >= 0 && dependencyIndex > stableIndex && diagnosticsIndex > dependencyIndex);
});

test("Gateway publishes stable dependency classifications", () => {
  for (const code of [
    "freeipa_dns_failed",
    "freeipa_tls_failed",
    "freeipa_timeout",
    "freeipa_auth_rejected",
    "freeipa_protocol_failed",
  ]) assert.equal(gateway.includes(code), true);
});

test("Docker never uses dependency health as its restart signal", () => {
  assert.equal(dockerfile.includes("fetch('http://127.0.0.1:3001/health/live')"), true);
  assert.equal(dockerfile.includes("/health/dependencies"), false);
});
