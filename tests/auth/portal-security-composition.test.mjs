import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortalSecurityComposition,
  portalSecurityCompatibilityOrder,
} from "../../worker/security-composition.ts";

test("security compatibility order is explicit and immutable", () => {
  assert.deepEqual(
    portalSecurityCompatibilityOrder.map((layer) => layer.id),
    [
      "maintenance-recovery",
      "service-admin-authentication",
      "pre-session-route-guards",
      "local-session-and-origin",
      "settings-context-adaptation",
      "canonical-request-context",
      "downstream-authorization-audit",
    ],
  );
  assert.equal(Object.isFrozen(portalSecurityCompatibilityOrder), true);
  for (const layer of portalSecurityCompatibilityOrder) {
    assert.equal(Object.isFrozen(layer), true);
    assert.ok(layer.owner.startsWith("worker/"), layer.id);
    assert.ok(layer.responsibility.length > 10, layer.id);
  }
});

test("security composition delegates request environment context and scheduled execution unchanged", async () => {
  const request = new Request("https://portal.test/api/integrations/catalog");
  const env = { marker: "env-alpha" };
  const ctx = { marker: "ctx-alpha" };
  const controller = { cron: "*/5 * * * *" };
  const calls = [];

  const security = createPortalSecurityComposition({
    async fetch(actualRequest, actualEnv, actualCtx) {
      calls.push(["fetch", actualRequest, actualEnv, actualCtx]);
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    },
    scheduled(actualController, actualEnv, actualCtx) {
      calls.push(["scheduled", actualController, actualEnv, actualCtx]);
    },
  });

  const response = await security.fetch(request, env, ctx);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls[0][1], request);
  assert.equal(calls[0][2], env);
  assert.equal(calls[0][3], ctx);

  await security.scheduled(controller, env, ctx);
  assert.equal(calls[1][1], controller);
  assert.equal(calls[1][2], env);
  assert.equal(calls[1][3], ctx);
});
