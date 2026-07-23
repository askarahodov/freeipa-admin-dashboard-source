import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class ResultsD1 {
  runs = [];
  replays = [];
  results = [];

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO operation_runs")) {
          const row = {
            id: values[0], job_id: values[1], event_id: values[2], title: values[3], kind: values[4], mode: values[5],
            status: values[6], actor: values[7], subject: values[8], error: values[9], stages_json: values[10], started_at: values[11], updated_at: values[12], completed_at: values[13],
          };
          const index = this.runs.findIndex((item) => item.id === row.id);
          if (index >= 0) this.runs[index] = { ...this.runs[index], ...row };
          else this.runs.push(row);
        }
        if (sql.startsWith("INSERT INTO operation_run_replays")) {
          const row = { run_id: values[0], event_id: values[1], schema_version: values[2], encrypted_spec: values[3], replayable: values[4], reason: values[5], parent_run_id: values[6], created_at: values[7] };
          const index = this.replays.findIndex((item) => item.run_id === row.run_id);
          if (index >= 0) this.replays[index] = row;
          else this.replays.push(row);
        }
        if (sql.startsWith("INSERT INTO operation_run_results")) {
          const row = { run_id: values[0], job_id: values[1], summary: values[2], values_json: values[3], links_json: values[4], files_json: values[5], table_json: values[6], truncated: values[7], captured_at: values[8] };
          const index = this.results.findIndex((item) => item.run_id === row.run_id);
          if (index >= 0) this.results[index] = row;
          else this.results.push(row);
        }
        return { success: true, meta: { changes: 1 } };
      },
      first: async () => {
        if (sql.includes("FROM operation_run_results WHERE run_id = ?")) return this.results.find((item) => item.run_id === values[0]) ?? null;
        return null;
      },
      all: async () => {
        if (sql.includes("FROM operation_runs ORDER BY")) return { results: [...this.runs].sort((a, b) => b.started_at - a.started_at).slice(0, Number(values[0] ?? 100)) };
        if (sql.includes("FROM operation_run_replays WHERE run_id IN")) return { results: this.replays.filter((item) => values.includes(item.run_id)) };
        if (sql.includes("FROM operation_run_results WHERE run_id IN")) return { results: this.results.filter((item) => values.includes(item.run_id)) };
        return { results: [] };
      },
    };
    return statement;
  }
}

function operatorEnv(db) {
  return {
    DB: db,
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "xyops-secret",
    CONFIG_ENCRYPTION_KEY: "11".repeat(32),
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "operator@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
  };
}

test("captures sanitized XYOps result widgets and proxies output files", async () => {
  const originalFetch = globalThis.fetch;
  const db = new ResultsD1();
  let verboseRequested = false;
  let fileApiKey = "";

  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const requestHeaders = typeof input === "string" || input instanceof URL ? undefined : input.headers;
    const url = new URL(rawUrl);
    const headers = new Headers(init.headers ?? requestHeaders);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [{ id: "backup-db", title: "Backup DB", type: "workflow", user_fields: [{ id: "database", title: "Database", required: true, target: "workflowData" }] }] });
    if (url.pathname.endsWith("/run_event/v1")) return Response.json({ id: "job_result_42", status: "queued" });
    if (url.pathname.endsWith("/get_active_jobs/v1")) return Response.json({ code: 0, rows: [] });
    if (url.pathname.endsWith("/get_jobs/v1")) {
      const body = JSON.parse(String(init.body ?? "{}"));
      verboseRequested = body.verbose === true;
      return Response.json({ code: 0, jobs: [{
        id: "job_result_42",
        completed: 1_784_000_000,
        code: 0,
        description: "Backup completed successfully",
        data: {
          backup: { database: "billing", records: 42, verified: true, reportUrl: "https://reports.example.test/jobs/42" },
          api_token: "must-not-leak",
          signedUrl: "https://reports.example.test/private?token=must-not-leak",
        },
        table: { columns: ["Database", "Rows"], rows: [["billing", 42]] },
        files: [
          { source: "output", filename: "backup.csv", path: "files/jobs/job_result_42/backup.csv", size: 128, mime_type: "text/csv" },
          { source: "input", filename: "request.json", path: "files/jobs/job_result_42/request.json", size: 12 },
          { source: "output", filename: "escape.txt", path: "../secret.txt", size: 5 },
          { source: "output", filename: "origin.txt", path: "https:evil.example/secret.txt", size: 5 },
        ],
        html: "<script>alert('must-not-leak')</script>",
        output: "XYOPS_API_KEY=must-not-leak",
      }] });
    }
    if (url.pathname === "/files/jobs/job_result_42/backup.csv") {
      fileApiKey = headers.get("x-api-key") ?? "";
      return new Response("id,name\n1,A\n", { headers: { "content-type": "text/csv", "content-length": "12" } });
    }
    if (url.pathname.includes("/api/app/")) return Response.json({ code: 0, rows: [] });
    return new Response("not found", { status: 404 });
  };

  try {
    const env = operatorEnv(db);
    const launch = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "backup-db", values: { database: "billing" } }),
    }), env, {});
    assert.equal(launch.status, 202);

    const response = await worker.fetch(new Request("https://portal.test/api/integrations/runs?sync=1"), env, {});
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(verboseRequested, true);
    assert.equal(payload.runs[0].status, "success");
    assert.equal(payload.runs[0].result.available, true);
    assert.equal(payload.runs[0].result.summary, "Backup completed successfully");
    assert.ok(payload.runs[0].result.values.some((item) => item.label === "Records" && item.value === "42"));
    assert.ok(payload.runs[0].result.values.some((item) => item.label === "Verified" && item.value === "true"));
    assert.deepEqual(payload.runs[0].result.links.map((item) => item.url), ["https://reports.example.test/jobs/42"]);
    assert.deepEqual(payload.runs[0].result.table, { columns: ["Database", "Rows"], rows: [["billing", "42"]] });
    assert.equal(payload.runs[0].result.files.length, 1);
    assert.equal(payload.runs[0].result.files[0].filename, "backup.csv");
    assert.match(payload.runs[0].result.files[0].downloadUrl, /^\/api\/integrations\/runs\//);
    assert.equal("path" in payload.runs[0].result.files[0], false);
    assert.doesNotMatch(JSON.stringify(payload), /must-not-leak|<script>|XYOPS_API_KEY/);

    const fileResponse = await worker.fetch(new Request(`https://portal.test${payload.runs[0].result.files[0].downloadUrl}`), env, {});
    assert.equal(fileResponse.status, 200);
    assert.equal(fileApiKey, "xyops-secret");
    assert.equal(fileResponse.headers.get("content-type"), "application/octet-stream");
    assert.match(fileResponse.headers.get("content-disposition") ?? "", /backup\.csv/);
    assert.equal(await fileResponse.text(), "id,name\n1,A\n");

    const missing = await worker.fetch(new Request(`https://portal.test/api/integrations/runs/${payload.runs[0].id}/files/file-missing`), env, {});
    assert.equal(missing.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
