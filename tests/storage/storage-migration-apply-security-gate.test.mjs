import assert from "node:assert/strict";
import test from "node:test";

import { handleStorageMigrationApplyGate } from "../../worker/middleware/storage-migration-apply.ts";

function request(path = "/api/other") {
  return new Request(`https://portal.test${path}`, { headers: { "x-test-marker": "preserve-me" } });
}

test("migration response short-circuits downstream without rewriting the response", async () => {
  const sourceRequest = request("/api/admin/storage/migrations/apply");
  const env = { marker: "env" };
  const ctx = { marker: "ctx" };
  const expected = new Response(JSON.stringify({ ok: false, code: "migration_apply_authorization_required" }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  let downstreamCalls = 0;

  const response = await handleStorageMigrationApplyGate(sourceRequest, env, ctx, {
    handleApply: async (observedRequest, observedEnv) => {
      assert.equal(observedRequest, sourceRequest);
      assert.equal(observedEnv, env);
      return expected;
    },
    nextFetch: async () => {
      downstreamCalls += 1;
      return new Response("unexpected");
    },
  });

  assert.equal(response, expected);
  assert.equal(response.status, 401);
  assert.equal(downstreamCalls, 0);
});

test("non-migration traffic passes request env and context downstream unchanged exactly once", async () => {
  const sourceRequest = request();
  const env = { marker: "env" };
  const ctx = { marker: "ctx" };
  const expected = new Response("compatibility", { status: 202 });
  let handlerCalls = 0;
  let downstreamCalls = 0;

  const response = await handleStorageMigrationApplyGate(sourceRequest, env, ctx, {
    handleApply: async (observedRequest, observedEnv) => {
      handlerCalls += 1;
      assert.equal(observedRequest, sourceRequest);
      assert.equal(observedEnv, env);
      return null;
    },
    nextFetch: async (observedRequest, observedEnv, observedContext) => {
      downstreamCalls += 1;
      assert.equal(observedRequest, sourceRequest);
      assert.equal(observedEnv, env);
      assert.equal(observedContext, ctx);
      assert.equal(observedRequest.headers.get("x-test-marker"), "preserve-me");
      return expected;
    },
  });

  assert.equal(response, expected);
  assert.equal(handlerCalls, 1);
  assert.equal(downstreamCalls, 1);
});

test("a handled maintenance-independent failure remains authoritative", async () => {
  const expected = new Response(JSON.stringify({ ok: false, code: "migration_apply_method_not_allowed" }), {
    status: 405,
    headers: { allow: "POST" },
  });

  const response = await handleStorageMigrationApplyGate(request("/api/admin/storage/migrations/apply"), {}, {}, {
    handleApply: async () => expected,
    nextFetch: async () => new Response("maintenance", { status: 503 }),
  });

  assert.equal(response, expected);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});
