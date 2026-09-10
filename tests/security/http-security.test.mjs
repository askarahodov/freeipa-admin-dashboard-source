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

test("HSTS requires both HTTPS and explicit production opt-in", () => {
  assert.equal(secured("http://portal.local/", { PORTAL_HSTS_ENABLED: "true" }).headers.get("strict-transport-security"), null);
  assert.equal(secured("https://portal.local/").headers.get("strict-transport-security"), null);
  assert.equal(
    secured("https://portal.local/", { PORTAL_HSTS_ENABLED: "true" }).headers.get("strict-transport-security"),
    httpSecurityContract.hsts,
  );
});

test("report-only mode is explicit and does not emit enforcing CSP", () => {
  const response = secured("https://portal.local/", { PORTAL_CSP_MODE: "report-only" });
  assert.equal(response.headers.get("content-security-policy"), null);
  assert.equal(response.headers.get("content-security-policy-report-only"), httpSecurityContract.csp);
});

test("existing response metadata and download headers are preserved", async () => {
  const source = new Response("payload", {
    status: 206,
    headers: {
      "content-disposition": "attachment; filename=export.json",
      "content-type": "application/json",
      "x-custom": "kept",
    },
  });
  const response = secured("https://portal.local/api/export", { PORTAL_HSTS_ENABLED: "true" }, source);

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-disposition"), "attachment; filename=export.json");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("x-custom"), "kept");
  assert.equal(await response.text(), "payload");
});

test("upstream wildcard CORS is not introduced or widened by security middleware", () => {
  const response = secured("https://portal.local/api", {}, new Response("ok", { headers: { vary: "origin" } }));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
