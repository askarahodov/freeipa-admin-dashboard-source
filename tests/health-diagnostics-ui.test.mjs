import assert from "node:assert/strict";
import test from "node:test";
import { handleHealthDiagnosticsRequest } from "../worker/health-diagnostics-ui.ts";

async function text(response) {
  return await response.text();
}

test("diagnostics HTML is hardened, self-contained and incident-oriented", async () => {
  const response = await handleHealthDiagnosticsRequest(new Request("https://portal.test/diagnostics/health"));

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(csp.includes("unsafe-inline"), false);

  const html = await text(response);
  assert.match(html, /<title>Health diagnostics · FreeIPA Admin Dashboard<\/title>/);
  assert.match(html, /href="\/diagnostics\/health\.css"/);
  assert.match(html, /src="\/diagnostics\/health\.js"/);
  assert.match(html, /id="live-card"/);
  assert.match(html, /id="ready-card"/);
  assert.match(html, /id="dependency-list"/);
  assert.match(html, /id="remediation-list"/);
  assert.match(html, /id="refresh-health"/);
  assert.match(html, /id="copy-health"/);
  assert.match(html, /Не перезапускайте портал только из-за degraded dependency state/);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<style>"), false);
  assert.equal(html.includes("onClick="), false);
  assert.equal(html.includes("internal.example"), false);
});

test("diagnostics JavaScript consumes only sanitized health contracts", async () => {
  const response = await handleHealthDiagnosticsRequest(new Request("https://portal.test/diagnostics/health.js"));

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const script = await text(response);

  assert.match(script, /"\/health\/live"/);
  assert.match(script, /"\/health\/ready"/);
  assert.match(script, /"\/health\/dependencies"/);
  assert.match(script, /cache: "no-store"/);
  assert.match(script, /AbortSignal\.timeout\(5000\)/);
  assert.match(script, /textContent/);
  assert.match(script, /freeipa_dns_failed/);
  assert.match(script, /freeipa_tls_failed/);
  assert.match(script, /freeipa_timeout/);
  assert.match(script, /xyops_auth_rejected/);
  assert.match(script, /xyops_rate_limited/);
  assert.match(script, /dependency_schema_unready/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /JSON\.stringify\(sanitizedSnapshot/);

  for (const forbidden of ["innerHTML", "eval(", "localStorage", "sessionStorage", "document.cookie", "http://", "https://", "Authorization", "x-api-key"]) {
    assert.equal(script.includes(forbidden), false, `forbidden browser primitive: ${forbidden}`);
  }
});

test("diagnostics CSS exposes responsive and accessible state styling", async () => {
  const response = await handleHealthDiagnosticsRequest(new Request("https://portal.test/diagnostics/health.css"));

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/css/);
  const css = await text(response);
  assert.match(css, /\.state-healthy/);
  assert.match(css, /\.state-degraded/);
  assert.match(css, /\.state-unready/);
  assert.match(css, /\.dependency-grid/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /:focus-visible/);
});

test("diagnostics handler ignores unrelated routes and rejects mutations", async () => {
  assert.equal(
    await handleHealthDiagnosticsRequest(new Request("https://portal.test/health/live")),
    null,
  );

  const response = await handleHealthDiagnosticsRequest(new Request("https://portal.test/diagnostics/health", { method: "POST" }));
  assert.ok(response);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), { ok: false, code: "health_diagnostics_method_not_allowed" });
});
