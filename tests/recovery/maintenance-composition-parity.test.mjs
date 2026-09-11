import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMaintenanceGate,
  handleMaintenanceScheduledGate,
} from "../../worker/maintenance-mode-gate.ts";

function inactiveRow() {
  return {
    id: "main",
    state: "inactive",
    operationId: null,
    actorIdentity: null,
    actorGroups: [],
    controllerSecretHash: null,
    createdAt: null,
    updatedAt: 1,
    expiresAt: null,
    completedAt: null,
    failureCode: null,
    verification: {},
  };
}

test("inactive maintenance delegates exact request env and context once", async () => {
  const request = new Request("https://portal.example/api/integrations/users");
  const env = { DB: {} };
  const ctx = { marker: "ctx" };
  const calls = [];

  const response = await handleMaintenanceGate(request, env, ctx, {
    async loadState() {
      calls.push("load");
      return inactiveRow();
    },
    async nextFetch(nextRequest, nextEnv, nextContext) {
      calls.push("fetch");
      assert.equal(nextRequest, request);
      assert.equal(nextEnv, env);
      assert.equal(nextContext, ctx);
      return new Response("ok");
    },
    async nextScheduled() {
      assert.fail("scheduled path must not run during fetch");
    },
  });

  assert.equal(await response.text(), "ok");
  assert.deepEqual(calls, ["load", "fetch"]);
});

test("active maintenance short-circuits without invoking downstream", async () => {
  let delegated = false;
  const response = await handleMaintenanceGate(
    new Request("https://portal.example/api/integrations/users"),
    { DB: {} },
    {},
    {
      async loadState() {
        return { ...inactiveRow(), state: "active", operationId: "maintenance_test" };
      },
      async nextFetch() {
        delegated = true;
        return new Response("unexpected");
      },
      async nextScheduled() {},
    },
  );

  assert.equal(response.status, 503);
  assert.equal(delegated, false);
});

test("inactive scheduled maintenance delegates exact controller env and context once", async () => {
  const controller = { cron: "* * * * *" };
  const env = { DB: {} };
  const ctx = { marker: "ctx" };
  const calls = [];

  await handleMaintenanceScheduledGate(controller, env, ctx, {
    async loadState() {
      calls.push("load");
      return inactiveRow();
    },
    async nextFetch() {
      assert.fail("fetch path must not run during scheduled dispatch");
    },
    async nextScheduled(nextController, nextEnv, nextContext) {
      calls.push("scheduled");
      assert.equal(nextController, controller);
      assert.equal(nextEnv, env);
      assert.equal(nextContext, ctx);
    },
  });

  assert.deepEqual(calls, ["load", "scheduled"]);
});
