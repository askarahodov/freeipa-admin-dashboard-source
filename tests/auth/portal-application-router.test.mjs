import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { portalRouteContracts } from "../../src/auth/portal-route-contract.ts";
import {
  createPortalApplicationRouter,
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

test("maintenance composition routes ordinary fetch through the application boundary while scheduled stays compatible", async () => {
  const source = await readFile(new URL("../../worker/maintenance-mode-root-entry.ts", import.meta.url), "utf8");
  assert.match(source, /createPortalApplicationRouter/);
  assert.match(source, /return applicationRouter\.fetch\(request, env, ctx\)/);
  assert.match(source, /return rootRuntime\.scheduled\?\.\(controller, env, ctx\)/);
});
