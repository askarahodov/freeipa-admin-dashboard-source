import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaEntry = fs.readFileSync(new URL("../worker/schema-migrations-entry.ts", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../scripts/freeipa-gateway.mjs", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

test("dependency health dispatch precedes ordinary runtime gates", () => {
  assert.equal(schemaEntry.includes('import { handleDependencyHealthRequest } from "./dependency-health.ts"'), true);
  assert.equal(schemaEntry.includes("const dependencyHealthResponse = await handleDependencyHealthRequest"), true);
  assert.equal(schemaEntry.includes("if (dependencyHealthResponse) return dependencyHealthResponse"), true);
  const liveIndex = schemaEntry.indexOf("const healthResponse = await handleHealthRequest");
  const dependencyIndex = schemaEntry.indexOf("const dependencyHealthResponse = await handleDependencyHealthRequest");
  assert.ok(dependencyIndex > liveIndex);
  assert.ok(dependencyIndex < schemaEntry.indexOf('url.pathname === "/api/schema/status"'));
  assert.ok(dependencyIndex < schemaEntry.indexOf("if (!sourceEnv.DB)"));
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
