import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class RunsD1 {
  rows = [];

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO operation_runs")) {
          const row = {
            id: values[0], job_id: values[1], event_id: values[2], title: values[3], kind: values[4], mode: values[5],
            status: values[6], actor: values[7], subject: values[8], error: values[9], started_at: values[10], updated_at: values[11], completed_at: values[12],
          };
          const index = this.rows.findIndex((item) => item.id === row.id);
          if (index >= 0) this.rows[index] = row;
          else this.rows.push(row);
        }
        return { success: true };
      },
      first: async () => null,
      all: async () => ({ results: [...this.rows].sort((a, b) => b.started_at - a.started_at).slice(0, Number(values[0] ?? 100)) }),
    };
    return statement;
  }
}

test("persists XYOps launches and synchronizes their status", async () => {
  const originalFetch = globalThis.fetch;
  const db = new RunsD1();
  let activeStatus = "running";
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [{ id: "backup-db", title: "Backup DB", type: "workflow", user_fields: [{ id: "database", title: "Database", required: true, target: "workflowData" }] }] });
    if (url.pathname.endsWith("/run_event/v1")) return Response.json({ job_id: "job-42", status: "queued", internal_secret: "must-not-leak" });
    if (url.pathname.endsWith("/get_active_jobs/v1")) return Response.json({ jobs: [{ job_id: "job-42", status: activeStatus }] });
    return new Response("not found", { status: 404 });
  };

  const env = { DB: db, XYOPS_URL: "https://xyops.example.test", XYOPS_API_KEY: "secret" };
  try {
    const launched = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", {
      method: "POST",
      headers: { "content-type": "application/json", "oai-authenticated-user-email": "operator@example.test" },
      body: JSON.stringify({ eventId: "backup-db", values: { database: "billing" } }),
    }), env, {});
    assert.equal(launched.status, 202);
    const launchBody = await launched.json();
    assert.equal(launchBody.jobId, "job-42");
    assert.equal(launchBody.status, "queued");
    assert.doesNotMatch(JSON.stringify(launchBody), /must-not-leak/);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].actor, "operator@example.test");
    assert.equal(db.rows[0].subject, "billing");

    const runningResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/runs?sync=1"), env, {});
    assert.equal(runningResponse.status, 200);
    const running = await runningResponse.json();
    assert.equal(running.runs[0].status, "running");
    assert.equal(running.stats.queued, 1);

    activeStatus = "success";
    const completedResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/runs?sync=1"), env, {});
    const completed = await completedResponse.json();
    assert.equal(completed.runs[0].status, "success");
    assert.equal(completed.stats.success, 1);
    assert.ok(completed.runs[0].completedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("records rejected XYOps launches as failed without persisting response bodies", async () => {
  const originalFetch = globalThis.fetch;
  const db = new RunsD1();
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [{ id: "danger", title: "Danger", type: "event" }] });
    if (url.pathname.endsWith("/run_event/v1")) return Response.json({ error: "private backend details", token: "leak" }, { status: 500 });
    return new Response("not found", { status: 404 });
  };
  try {
    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: "danger", values: {} }) }), { DB: db, XYOPS_URL: "https://xyops.example.test", XYOPS_API_KEY: "secret" }, {});
    assert.equal(response.status, 502);
    assert.equal(db.rows[0].status, "failed");
    assert.doesNotMatch(JSON.stringify(db.rows[0]), /private backend details|leak/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
