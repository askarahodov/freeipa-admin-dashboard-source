import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

test("discovers, validates and launches a schema-driven XYOps workflow", async () => {
  const originalFetch = globalThis.fetch;
  let launchPayload;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/get_events/v1")) {
      return Response.json({ events: [{
        id: "backup-postgres",
        title: "Backup PostgreSQL",
        description: "Create database backup",
        type: "workflow",
        category: "Databases",
        targets: ["db-01", "db-02"],
        user_fields: [
          { id: "database", title: "Database", type: "text", required: true, target: "workflowData" },
          { id: "retention", title: "Retention", type: "number", required: true, min: 1, max: 365, destination: "workflowData" },
          { id: "verify", title: "Verify", type: "checkbox", default: true, scope: "workflowData" },
          { id: "formats", title: "Formats", type: "multimenu", options: ["custom", "sql"], target: "workflowData" },
          { id: "metadata", title: "Metadata", type: "json", target: "input" },
        ],
      }] });
    }
    if (url.pathname.endsWith("/run_event/v1")) {
      launchPayload = JSON.parse(String(init.body));
      return Response.json({ job_id: "job-42" });
    }
    return new Response("not found", { status: 404 });
  };

  const env = { XYOPS_URL: "https://xyops.example.test", XYOPS_API_KEY: "api-secret" };
  try {
    const catalogResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), env, {});
    const catalog = await catalogResponse.json();
    assert.equal(catalog.mode, "live");
    assert.deepEqual(catalog.events[0].fields.map((field) => [field.key, field.type, field.target]), [
      ["database", "string", "workflowData"],
      ["retention", "number", "workflowData"],
      ["verify", "boolean", "workflowData"],
      ["formats", "multiselect", "workflowData"],
      ["metadata", "json", "input"],
    ]);

    const runResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: "backup-postgres", targets: ["db-02"], values: { database: "billing", retention: "30", verify: true, formats: ["custom"], metadata: "{\"ticket\":\"OPS-7\"}" } }) }), env, {});
    assert.equal(runResponse.status, 202);
    assert.equal((await runResponse.json()).jobId, "job-42");
    assert.deepEqual(launchPayload, {
      id: "backup-postgres",
      params: { source: "xyops-self-service" },
      input: { data: { source: "xyops-self-service", metadata: { ticket: "OPS-7" } } },
      workflowData: { database: "billing", retention: 30, verify: true, formats: ["custom"] },
      targets: ["db-02"],
    });

    const rejected = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: "unknown-process", values: {} }) }), env, {});
    assert.equal(rejected.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
