import assert from "node:assert/strict";
import test from "node:test";

import { resolvePortalApplicationRoute } from "../../worker/application-router.ts";
import {
  handleHealthApplicationRoute,
  isHealthApplicationRoute,
  isPreSchemaHealthApplicationRequest,
} from "../../worker/health-http.ts";

function request(path, init = {}) {
  return new Request(`https://portal.test${path}`, init);
}

async function health(path, init = {}, env = {}) {
  const input = request(path, init);
  const route = resolvePortalApplicationRoute(input);
  assert.equal(isHealthApplicationRoute(route), true, `${input.method} ${path}`);
  const response = await handleHealthApplicationRoute(input, env, route);
  assert.ok(response, `${input.method} ${path} must be handled by health HTTP owner`);
  return response;
}

test("pre-schema health classification reuses application routing for stable supplemental and method mismatch", () => {
  for (const [path, init] of [
    ["/health/live", {}],
    ["/health/ready", {}],
    ["/api/integrations/health", {}],
    ["/health/dependencies", {}],
    ["/diagnostics/health", {}],
    ["/diagnostics/health.js", {}],
    ["/diagnostics/health.css", {}],
    ["/metrics/health", {}],
    ["/health/live", { method: "POST" }],
  ]) {
    assert.equal(isPreSchemaHealthApplicationRequest(request(path, init)), true, `${init.method ?? "GET"} ${path}`);
  }

  for (const path of ["/api/maintenance/status", "/_vinext/image", "/api/integrations/status", "/settings"]) {
    assert.equal(isPreSchemaHealthApplicationRequest(request(path)), false, path);
  }
});

test("liveness and deprecated compatibility health remain schema and integration independent", async () => {
  const live = await health("/health/live", {}, {
    PORTAL_BUILD_VERSION: "test-build",
    IPA_NODE_GATEWAY_URL: "http://127.0.0.1:9999",
    IPA_NODE_GATEWAY_TOKEN: "must-not-be-read-for-live",
  });
  assert.equal(live.status, 200);
  const payload = await live.json();
  assert.equal(payload.check, "liveness");
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.checks, []);

  const legacy = await health("/api/integrations/health");
  assert.equal(legacy.status, 200);
  assert.deepEqual(await legacy.json(), { ok: true });
  assert.equal(legacy.headers.get("deprecation"), "true");
});

test("readiness and dependency health preserve fail-closed database behavior", async () => {
  const ready = await health("/health/ready");
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).code, "health_database_unavailable");

  const dependencies = await health("/health/dependencies");
  assert.equal(dependencies.status, 503);
  assert.equal((await dependencies.json()).code, "dependency_database_unavailable");
});

test("diagnostics assets and metrics are served by the same owner without invoking dependency health", async () => {
  const document = await health("/diagnostics/health");
  assert.equal(document.status, 200);
  assert.match(document.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(document.headers.get("content-security-policy") ?? "", /default-src 'none'/);

  const metrics = await health("/metrics/health");
  assert.equal(metrics.status, 200);
  const body = await metrics.text();
  assert.match(body, /portal_health_live 1/);
  assert.match(body, /portal_health_ready 0/);
  assert.match(body, /mode="cached_json",path="\/health\/dependencies"/);
});

test("health-specific method errors stay authoritative before generic negative finalization", async () => {
  const live = await health("/health/live", { method: "POST" });
  assert.equal(live.status, 405);
  assert.equal(live.headers.get("allow"), "GET");
  assert.deepEqual(await live.json(), { ok: false, code: "health_method_not_allowed" });

  const diagnostics = await health("/diagnostics/health", { method: "POST" });
  assert.equal(diagnostics.status, 405);
  assert.equal(diagnostics.headers.get("allow"), "GET");
  assert.deepEqual(await diagnostics.json(), { ok: false, code: "health_diagnostics_method_not_allowed" });
});

test("non-health application routes are never claimed by the health adapter", async () => {
  const input = request("/api/maintenance/status");
  const route = resolvePortalApplicationRoute(input);
  assert.equal(isHealthApplicationRoute(route), false);
  assert.equal(await handleHealthApplicationRoute(input, {}, route), null);
});
