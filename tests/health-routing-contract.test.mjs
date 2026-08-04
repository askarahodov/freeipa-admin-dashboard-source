import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../scripts/freeipa-gateway.mjs", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

test("health dispatch is outside schema, maintenance and authentication gates", () => {
  assert.equal(schemaEntry.includes('import { handleHealthRequest } from "./health-contracts.ts"'), true);
  assert.equal(schemaEntry.includes("const healthResponse = await handleHealthRequest"), true);
  assert.equal(schemaEntry.includes("if (healthResponse) return healthResponse"), true);
  const healthIndex = schemaEntry.indexOf("const healthResponse = await handleHealthRequest");
  assert.ok(healthIndex >= 0);
  assert.ok(healthIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(healthIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));
  assert.ok(healthIndex < schemaEntry.indexOf("await portalSchema(sourceEnv)"));
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
