import assert from "node:assert/strict";
import test from "node:test";

import { applyHttpSecurityHeaders, httpSecurityContract } from "../../scripts/http-security.mjs";

function secured(url, env = {}, response = new Response("ok", { headers: { "content-type": "text/html" } })) {
  return applyHttpSecurityHeaders(new Request(url), response, env);
}

test("enforcing browser security headers are present by default", () => {
  const response = secured("http://portal.local/");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.equal(csp, httpSecurityContract.csp);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.equal(response.headers.get("content-security-policy-report-only"), null);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("route-owned enforcing CSP is preserved instead of being weakened", () => {
  const strictCsp = "default-src 'none'; script-src 'self'; style-src 'self'; frame-ancestors 'none'";
  const source = new Response("diagnostics", { headers: { "content-security-policy": strictCsp } });
  const response = secured("https://portal.local/diagnostics/health", {}, source);
  assert.equal(response.headers.get("content-security-policy"), strictCsp);
  assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", /unsafe-inline/);
});

test("HSTS requires both HTTPS and explicit opt-in", () => {
  assert.equal(secured("http://portal.local/", { PORTAL_HSTS_ENABLED: "true" }).headers.get("strict-transport-security"), null);
  assert.equal(secured("https://portal.local/").headers.get("strict-transport-security"), null);
  assert.equal(secured("https://portal.local/", { PORTAL_HSTS_ENABLED: "true" }).headers.get("strict-transport-security"), httpSecurityContract.hsts);
});

test("report-only mode is explicit and does not replace an existing enforcing CSP", () => {
  const strictCsp = "default-src 'none'; frame-ancestors 'none'";
  const source = new Response("diagnostics", { headers: { "content-security-policy": strictCsp } });
  const response = secured("https://portal.local/diagnostics/health", { PORTAL_CSP_MODE: "report-only" }, source);
  assert.equal(response.headers.get("content-security-policy"), strictCsp);
  assert.equal(response.headers.get("content-security-policy-report-only"), httpSecurityContract.csp);
});

test("download metadata is preserved and wildcard CORS is not introduced", async () => {
  const source = new Response("payload", {
    status: 206,
    headers: { "content-disposition": "attachment; filename=export.json", "content-type": "application/json", "x-custom": "kept" },
  });
  const response = secured("https://portal.local/api/export", { PORTAL_HSTS_ENABLED: "true" }, source);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-disposition"), "attachment; filename=export.json");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("x-custom"), "kept");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(await response.text(), "payload");
});
