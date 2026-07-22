import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

test("discovers, validates and launches a schema-driven XYOps workflow", async () => {
  const originalFetch = globalThis.fetch;
  let launchPayload;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
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
          { id: "mode", title: "Mode", type: "select", options: ["basic", "full"], section: "Advanced", order: 10, target: "workflowData" },
          { id: "ticket", title: "Approval ticket", type: "text", required: true, section: "Advanced", visible_when: { field: "mode", equals: "full" }, target: "workflowData" },
          { id: "cluster", title: "Cluster", type: "select", options_endpoint: "/api/app/get_clusters/v1", options_query_param: "search", target: "workflowData" },
          { type: "group", title: "Connection", children: [{ type: "section", title: "TLS", fields: [{ id: "caProfile", title: "CA profile", type: "text", target: "input" }] }] },
        ],
      }] });
    }
    if (url.pathname.endsWith("/get_clusters/v1")) return Response.json({ items: [{ id: "cluster-a" }, { id: "cluster-b" }] });
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
      ["mode", "select", "workflowData"],
      ["ticket", "string", "workflowData"],
      ["cluster", "select", "workflowData"],
      ["caProfile", "string", "input"],
    ]);
    assert.deepEqual(catalog.events[0].fields.find((field) => field.key === "ticket").visibleWhen, { field: "mode", operator: "equals", value: "full" });
    assert.equal(catalog.events[0].fields.find((field) => field.key === "mode").section, "Advanced");
    assert.deepEqual(catalog.events[0].fields.find((field) => field.key === "cluster").optionsSource, { endpoint: "/api/app/get_clusters/v1", queryParam: "search" });
    assert.deepEqual(catalog.events[0].fields.find((field) => field.key === "caProfile").groupPath, ["Connection", "TLS"]);

    const optionsResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/options?eventId=backup-postgres&fieldKey=cluster&query=prod"), env, {});
    assert.deepEqual((await optionsResponse.json()).options, ["cluster-a", "cluster-b"]);

    const runResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: "backup-postgres", targets: ["db-02"], values: { database: "billing", retention: "30", verify: true, formats: ["custom"], metadata: "{\"ticket\":\"OPS-7\"}", mode: "full", ticket: "OPS-8", cluster: "cluster-a" } }) }), env, {});
    assert.equal(runResponse.status, 202);
    assert.equal((await runResponse.json()).jobId, "job-42");
    assert.deepEqual(launchPayload, {
      id: "backup-postgres",
      params: { source: "xyops-self-service" },
      input: { data: { source: "xyops-self-service", metadata: { ticket: "OPS-7" } } },
      workflowData: { database: "billing", retention: 30, verify: true, formats: ["custom"], mode: "full", ticket: "OPS-8", cluster: "cluster-a" },
      targets: ["db-02"],
    });

    const conditional = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: "backup-postgres", values: { database: "billing", retention: 7, mode: "basic" } }) }), env, {});
    assert.equal(conditional.status, 202);
    assert.equal("ticket" in launchPayload.workflowData, false);

    const missingConditional = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: "backup-postgres", values: { database: "billing", retention: 7, mode: "full" } }) }), env, {});
    assert.equal(missingConditional.status, 400);

    const rejected = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: "unknown-process", values: {} }) }), env, {});
    assert.equal(rejected.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

class CatalogMemoryD1 {
  snapshot = null;
  history = [];
  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO xyops_catalog_snapshot")) this.snapshot = { catalog_json: values[1], synced_at: values[2] };
        if (sql.startsWith("INSERT INTO xyops_catalog_history")) this.history.push({ id: values[0], synced_at: values[1], changes_json: values[2], catalog_json: values[3] });
        return { success: true };
      },
      all: async () => ({ results: [...this.history].sort((a, b) => b.synced_at - a.synced_at).slice(0, Number(values[0] ?? 20)) }),
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
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
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
    assert.match(first.events[0].schemaVersion, /^v1-[0-9a-f]{8}$/);
    assert.deepEqual(first.changes.map((change) => [change.id, change.kind]), [["backup", "new"]]);

    revision = 2;
    const second = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), env, {}).then((response) => response.json());
    assert.deepEqual(second.changes.map((change) => [change.id, change.kind]), [["backup", "changed"], ["restart", "new"]]);

    const history = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/history"), env, {}).then((response) => response.json());
    assert.equal(history.history.length, 2);
    const currentHistory = history.history.find((entry) => entry.processCount === 2);
    assert.deepEqual(currentHistory.changes.map((change) => change.kind), ["changed", "new"]);

    revision = 3;
    const cached = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog"), env, {}).then((response) => response.json());
    assert.equal(cached.mode, "cached");
    assert.equal(cached.stale, true);
    assert.deepEqual(cached.events.map((event) => event.id), ["backup", "restart"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
