import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workerRoot = fs.readFileSync(new URL("../../worker/http-security-root-entry.ts", import.meta.url), "utf8");
const policySource = fs.readFileSync(new URL("../../scripts/http-security.mjs", import.meta.url), "utf8");
const vite = fs.readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

test("Worker HTTP security root remains the outer Vite entry and delegates immediately to the schema boundary", () => {
  assert.equal(vite.includes('main: "./worker/http-security-root-entry.ts"'), true);
  assert.equal(workerRoot.includes('import rootRuntime from "./schema-migrations-entry.ts"'), true);
  assert.equal(workerRoot.includes('import { applyHttpSecurityHeaders } from "../scripts/http-security.mjs"'), true);
  assert.equal(workerRoot.includes("await rootRuntime.fetch(request, sourceEnv, ctx)"), true);
  assert.equal(workerRoot.includes("return applyHttpSecurityHeaders(request, response, sourceEnv)"), true);
  assert.equal(workerRoot.includes("return rootRuntime.scheduled?.(controller, env, ctx)"), true);
});

test("central HTTP security policy stays enforcing by default and HSTS remains explicit HTTPS-only opt-in", () => {
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "form-action 'self'"]) {
    assert.equal(policySource.includes(directive), true, directive);
  }
  assert.equal(policySource.includes('headers.set("x-frame-options", "DENY")'), true);
  assert.equal(policySource.includes('headers.set("x-content-type-options", "nosniff")'), true);
  assert.equal(policySource.includes('headers.set("referrer-policy", "no-referrer")'), true);
  assert.equal(policySource.includes('String(env?.PORTAL_CSP_MODE ?? "enforce")'), true);
  assert.equal(policySource.includes('enabled(env?.PORTAL_HSTS_ENABLED) && new URL(request.url).protocol === "https:"'), true);
  assert.equal(policySource.includes('headers.delete("strict-transport-security")'), true);
});
