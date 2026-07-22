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

class CatalogMemoryD1 {
  snapshot = null;
  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO xyops_catalog_snapshot")) this.snapshot = { catalog_json: values[1], synced_at: values[2] };
        return { success: true };
      },
      first: async () => {
        if (sql.startsWith("SELECT catalog_json")) return this.snapshot;
        return null;
      },
    };
    return statement;
  }
}

test("persists catalog snapshots, detects schema changes and falls back safely", async () => {
  const originalFetch = globalThis.fetch;
  const db = new CatalogMemoryD1();
  let revision = 1;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!url.pathname.endsWith("/get_events/v1")) return new Response("not found", { status: 404 });
    if (revision === 3) throw new Error("XYOps offline");
    return Response.json({ events: revision === 1
      ? [{ id: "backup", title: "Backup", type: "workflow", category: "Databases", user_fields: [{ id: "database", type: "text" }] }]
      : [{ id: "backup", title: "Backup", type: "workflow", category: "Databases", user_fields: [{ id: "database", type: "text", required: true }] }, { id: "restart", title: "Restart", type: "event", category: "Servers" }] });
  };
  const env = { DB: db, XYOPS_URL: "https://xyops.example.test", XYOPS_API_KEY: "secret" };
  try {
    const first = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), env, {}).then((response) => response.json());
    assert.equal(first.source, "xyops");
    assert.deepEqual(first.changes.map((change) => [change.id, change.kind]), [["backup", "new"]]);

    revision = 2;
    const second = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), env, {}).then((response) => response.json());
    assert.deepEqual(second.changes.map((change) => [change.id, change.kind]), [["backup", "changed"], ["restart", "new"]]);

    revision = 3;
    const cached = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), env, {}).then((response) => response.json());
    assert.equal(cached.mode, "cached");
    assert.equal(cached.stale, true);
    assert.deepEqual(cached.events.map((event) => event.id), ["backup", "restart"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
