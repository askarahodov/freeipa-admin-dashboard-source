import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { portalRouteContracts } from "../../src/auth/portal-route-contract.ts";
import {
  createPortalApplicationRouter,
  finalizePortalApplicationResponse,
  resolvePortalApplicationRoute,
} from "../../worker/application-router.ts";

function concretePath(pattern) {
  return pattern.replace(/:[A-Za-z0-9_]+/g, "sample-id");
}

test("every canonical stable route resolves through the explicit application router", () => {
  for (const contract of portalRouteContracts) {
    const pathname = concretePath(contract.path);
    const route = resolvePortalApplicationRoute(new Request(`https://portal.test${pathname}`, {
      method: contract.method,
    }));
    assert.equal(route.kind, "stable", `${contract.method} ${contract.path}`);
    assert.equal(route.match.contract.id, contract.id, `${contract.method} ${contract.path}`);
    assert.ok(route.allowedMethods.includes(contract.method), `${contract.method} ${contract.path}`);
  }
});

test("known route shapes expose method mismatch without inventing another path matcher", () => {
  const login = resolvePortalApplicationRoute(new Request("https://portal.test/api/auth/login", {
    method: "GET",
  }));
  assert.equal(login.kind, "method-not-allowed");
  assert.deepEqual(login.allowedMethods, ["POST"]);

  const user = resolvePortalApplicationRoute(new Request("https://portal.test/api/auth/users/user-1", {
    method: "PATCH",
  }));
  assert.equal(user.kind, "method-not-allowed");
  assert.deepEqual(user.allowedMethods, ["PUT", "DELETE"]);
});

test("supplemental infrastructure surfaces stay explicit and outside stable route metadata", () => {
  const expected = new Map([
    ["/health/dependencies", "dependency-health"],
    ["/diagnostics/health", "health-diagnostics"],
    ["/diagnostics/health.js", "health-diagnostics-asset"],
    ["/diagnostics/health.css", "health-diagnostics-asset"],
    ["/metrics/health", "health-metrics"],
    ["/api/maintenance/status", "public-maintenance-status"],
    ["/_vinext/image", "vinext-image"],
  ]);

  for (const [pathname, surface] of expected) {
    const route = resolvePortalApplicationRoute(new Request(`https://portal.test${pathname}`));
    assert.equal(route.kind, "supplemental", pathname);
    assert.equal(route.surface, surface, pathname);
  }
});

test("unknown API and framework/static traffic are classified separately", () => {
  const unknown = resolvePortalApplicationRoute(new Request("https://portal.test/api/not-a-real-route"));
  assert.deepEqual(unknown, { kind: "unknown-api", pathname: "/api/not-a-real-route" });

  const framework = resolvePortalApplicationRoute(new Request("https://portal.test/settings/general"));
  assert.deepEqual(framework, { kind: "framework", pathname: "/settings/general" });
});

test("compatibility dispatcher receives the original request, env and context unchanged", async () => {
  const request = new Request("https://portal.test/api/auth/session", {
    headers: { "x-test-marker": "preserve-me" },
  });
  const env = { marker: "env" };
  const ctx = { marker: "ctx" };
  const expectedResponse = new Response("compatibility-response", { status: 202 });
  let observed;

  const router = createPortalApplicationRouter(async (input) => {
    observed = input;
    return expectedResponse;
  });

  const response = await router.fetch(request, env, ctx);
  assert.equal(response, expectedResponse);
  assert.equal(observed.request, request);
  assert.equal(observed.env, env);
  assert.equal(observed.ctx, ctx);
  assert.equal(observed.request.headers.get("x-test-marker"), "preserve-me");
  assert.equal(observed.route.kind, "stable");
  assert.equal(observed.route.match.contract.id, "auth.session");
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.route), true);
});

test("known method mismatch gets the canonical 405 envelope only after compatibility returns 405", async () => {
  const route = resolvePortalApplicationRoute(new Request("https://portal.test/api/auth/users/user-1", {
    method: "PATCH",
  }));
  assert.equal(route.kind, "method-not-allowed");

  const downstream = new Response("legacy", {
    status: 405,
    headers: {
      "content-type": "text/plain",
      "cache-control": "private",
      "content-length": "6",
      "x-portal-maintenance-state": "inactive",
      "x-correlation-id": "correlation-1",
    },
  });
  const response = finalizePortalApplicationResponse(route, downstream);

  assert.notEqual(response, downstream);
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Method not allowed" });
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("x-portal-maintenance-state"), "inactive");
  assert.equal(response.headers.get("x-correlation-id"), "correlation-1");
  assert.equal(response.headers.get("allow"), null, "do not invent a new public Allow contract in #628");
});

test("method mismatch never promotes security maintenance or legacy-not-found responses to 405", () => {
  const route = resolvePortalApplicationRoute(new Request("https://portal.test/api/auth/users/user-1", {
    method: "PATCH",
  }));
  assert.equal(route.kind, "method-not-allowed");

  for (const status of [200, 401, 403, 404, 409, 429, 503]) {
    const downstream = new Response(`status-${status}`, { status });
    assert.equal(finalizePortalApplicationResponse(route, downstream), downstream, String(status));
  }
});

test("unknown API gets the canonical 404 envelope only after compatibility returns 404", async () => {
  const route = resolvePortalApplicationRoute(new Request("https://portal.test/api/not-a-real-route"));
  assert.equal(route.kind, "unknown-api");

  const downstream = new Response("framework or legacy not-found", {
    status: 404,
    headers: { "x-correlation-id": "correlation-2" },
  });
  const response = finalizePortalApplicationResponse(route, downstream);

  assert.notEqual(response, downstream);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-correlation-id"), "correlation-2");
});

test("unknown API keeps security and maintenance responses authoritative", () => {
  const route = resolvePortalApplicationRoute(new Request("https://portal.test/api/not-a-real-route"));
  assert.equal(route.kind, "unknown-api");

  for (const status of [200, 401, 403, 405, 409, 429, 503]) {
    const downstream = new Response(`status-${status}`, { status });
    assert.equal(finalizePortalApplicationResponse(route, downstream), downstream, String(status));
  }
});

test("stable supplemental and framework responses are never rewritten as routing errors", () => {
  const stable = resolvePortalApplicationRoute(new Request("https://portal.test/api/auth/session"));
  const supplemental = resolvePortalApplicationRoute(new Request("https://portal.test/api/maintenance/status"));
  const framework = resolvePortalApplicationRoute(new Request("https://portal.test/settings/general"));

  for (const route of [stable, supplemental, framework]) {
    for (const status of [404, 405]) {
      const downstream = new Response(`status-${status}`, { status });
      assert.equal(finalizePortalApplicationResponse(route, downstream), downstream, `${route.kind}:${status}`);
    }
  }
});

test("schema-gated traffic enters one application composition and scheduled remains compatibility delegated", async () => {
  const [schemaSource, applicationSource, maintenanceSource] = await Promise.all([
    readFile(new URL("../../worker/schema-migrations-entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../../worker/application.ts", import.meta.url), "utf8"),
    readFile(new URL("../../worker/maintenance-mode-root-entry.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schemaSource, /import rootRuntime from "\.\/application\.ts"/);
  assert.match(applicationSource, /import compatibilityRuntime from "\.\/maintenance-mode-root-entry\.ts"/);
  assert.match(applicationSource, /createPortalApplicationRouter/);
  assert.match(applicationSource, /const response = await compatibilityRuntime\.fetch\(request, env, ctx\)/);
  assert.match(applicationSource, /return finalizePortalApplicationResponse\(route, response\)/);
  assert.match(applicationSource, /return router\.fetch\(request, sourceEnv, ctx\)/);
  assert.match(applicationSource, /return compatibilityRuntime\.scheduled\?\.\(controller, env, ctx\)/);
  assert.doesNotMatch(maintenanceSource, /application-router/);
});
