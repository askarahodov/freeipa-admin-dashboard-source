import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

function operatorEnv(values = {}) {
  return {
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "operator@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "api-secret",
    ...values,
  };
}

const nestedCondition = {
  operator: "and",
  conditions: [
    { field: "mode", equals: "full" },
    {
      logic: "or",
      rules: [
        { field: "environment", operator: "in", values: ["prod", "stage"] },
        { not: { field: "emergency", operator: "falsy" } },
      ],
    },
  ],
};

test("normalizes and enforces nested AND OR NOT field dependencies", async () => {
  const originalFetch = globalThis.fetch;
  let launchPayload;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [{
      id: "deploy-service",
      title: "Deploy service",
      type: "workflow",
      user_fields: [
        { id: "mode", title: "Mode", type: "select", options: ["basic", "full"], required: true, target: "workflowData" },
        { id: "environment", title: "Environment", type: "select", options: ["dev", "stage", "prod"], required: true, target: "workflowData" },
        { id: "emergency", title: "Emergency", type: "checkbox", target: "workflowData" },
        { id: "approval", title: "Approval", type: "text", required: true, target: "workflowData", visible_when: nestedCondition },
      ],
    }] });
    if (url.pathname.endsWith("/run_event/v1")) {
      launchPayload = JSON.parse(String(init.body));
      return Response.json({ job_id: "job-nested" });
    }
    return new Response("not found", { status: 404 });
  };

  const env = operatorEnv();
  const run = async (values) => worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: "deploy-service", values }),
  }), env, {});

  try {
    const catalog = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), env, {}).then((response) => response.json());
    assert.deepEqual(catalog.events[0].fields.find((field) => field.key === "approval").visibleWhen, {
      all: [
        { field: "mode", operator: "equals", value: "full" },
        {
          any: [
            { field: "environment", operator: "in", value: ["prod", "stage"] },
            { not: { field: "emergency", operator: "falsy" } },
          ],
        },
      ],
    });

    const hiddenByMode = await run({ mode: "basic", environment: "prod", emergency: false });
    assert.equal(hiddenByMode.status, 202);
    assert.equal("approval" in launchPayload.workflowData, false);

    const hiddenByNestedOr = await run({ mode: "full", environment: "dev", emergency: false });
    assert.equal(hiddenByNestedOr.status, 202);
    assert.equal("approval" in launchPayload.workflowData, false);

    const requiredByEnvironment = await run({ mode: "full", environment: "prod", emergency: false });
    assert.equal(requiredByEnvironment.status, 400);
    assert.equal((await requiredByEnvironment.json()).error, "Invalid or missing field: approval");

    const requiredByNegatedFalsy = await run({ mode: "full", environment: "dev", emergency: true });
    assert.equal(requiredByNegatedFalsy.status, 400);

    const accepted = await run({ mode: "full", environment: "dev", emergency: true, approval: "CAB-42" });
    assert.equal(accepted.status, 202);
    assert.equal(launchPayload.workflowData.approval, "CAB-42");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
