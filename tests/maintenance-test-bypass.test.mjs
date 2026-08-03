import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMaintenanceGate,
  handleMaintenanceScheduledGate,
} from "../worker/maintenance-mode-gate.ts";
import { markSchemaTestBypass } from "../worker/schema-migrations-boundary.ts";

test("explicit process-local schema bypass delegates fetch without a database", async () => {
  const calls = [];
  const env = markSchemaTestBypass({});
  const response = await handleMaintenanceGate(
    new Request("https://portal.example/api/integrations/status"),
    env,
    {},
    {
      async loadState() {
        calls.push("load");
        throw new Error("must not read maintenance state");
      },
      async nextFetch(request) {
        calls.push(`fetch:${new URL(request.url).pathname}`);
        return new Response("delegated");
      },
      async nextScheduled() {
        throw new Error("unexpected scheduled call");
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "delegated");
  assert.deepEqual(calls, ["fetch:/api/integrations/status"]);
  assert.deepEqual(Object.keys(env), []);
});

test("explicit process-local schema bypass delegates scheduled work without a database", async () => {
  const calls = [];
  const env = markSchemaTestBypass({});
  await handleMaintenanceScheduledGate({}, env, {}, {
    async loadState() {
      calls.push("load");
      throw new Error("must not read maintenance state");
    },
    async nextFetch() {
      throw new Error("unexpected fetch call");
    },
    async nextScheduled() {
      calls.push("scheduled");
    },
  });

  assert.deepEqual(calls, ["scheduled"]);
});
