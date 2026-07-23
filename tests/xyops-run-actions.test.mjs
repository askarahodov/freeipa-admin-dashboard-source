import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class RunActionsD1 {
  runs = [];
  replays = [];

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
          if (index >= 0) this.runs[index] = row;
          else this.runs.push(row);
        }
        if (sql.startsWith("INSERT INTO operation_run_replays")) {
          const row = {
            run_id: values[0], event_id: values[1], schema_version: values[2], encrypted_spec: values[3], replayable: values[4], reason: values[5], parent_run_id: values[6], created_at: values[7],
          };
          const index = this.replays.findIndex((item) => item.run_id === row.run_id);
          if (index >= 0) this.replays[index] = row;
          else this.replays.push(row);
        }
        return { success: true, meta: { changes: 1 } };
      },
      all: async () => {
        if (sql.includes("FROM operation_run_replays")) {
          const ids = new Set(values.map(String));
          return { results: this.replays.filter((row) => ids.has(row.run_id)) };
        }
        if (sql.includes("FROM operation_runs")) {
          const limit = Number(values[0] ?? 100);
          return { results: [...this.runs].sort((a, b) => b.started_at - a.started_at).slice(0, limit) };
        }
        return { results: [] };
      },
      first: async () => {
        if (sql.includes("FROM operation_run_replays")) return this.replays.find((row) => row.run_id === String(values[0])) ?? null;
        return null;
      },
    };
    return statement;
  }
}

function operatorEnv(db) {
  return {
    DB: db,
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "api-secret",
    CONFIG_ENCRYPTION_KEY: "11".repeat(32),
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "operator@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
  };
}

test("cancels active XYOps jobs and safely re-runs completed portal launches", async () => {
  const originalFetch = globalThis.fetch;
  const db = new RunActionsD1();
  const launches = [];
  let sequence = 0;
  let schemaDrift = false;
  let abortedJob = "";

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [
      {
        id: "backup-db",
        title: "Backup DB",
        type: "workflow",
        user_fields: [
          { id: "database", title: "Database", type: "text", required: true, target: "workflowData" },
          ...(schemaDrift ? [{ id: "retention", title: "Retention", type: "number", target: "workflowData" }] : []),
        ],
      },
      { id: "secret-job", title: "Secret job", type: "event", user_fields: [{ id: "token", title: "Token", type: "password", required: true }] },
    ] });
    if (url.pathname.endsWith("/run_event/v1")) {
      const payload = JSON.parse(String(init.body));
      launches.push(payload);
      sequence += 1;
      return Response.json({ job_id: `job_${sequence}`, status: payload.id === "secret-job" ? "failed" : "queued" });
    }
    if (url.pathname.endsWith("/abort_job/v1")) {
      const payload = JSON.parse(String(init.body));
      abortedJob = payload.id;
      return Response.json({ code: 0 });
    }
    return new Response("not found", { status: 404 });
  };

  const env = operatorEnv(db);
  try {
    const launchResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "backup-db", values: { database: "billing" } }),
    }), env, {});
    assert.equal(launchResponse.status, 202);
    const launch = await launchResponse.json();
    assert.equal(launch.jobId, "job_1");
    assert.equal(db.replays.length, 1);
    assert.equal(db.replays[0].replayable, 1);
    assert.doesNotMatch(String(db.replays[0].encrypted_spec), /billing/);

    const activePayload = await worker.fetch(new Request("https://dashboard.test/api/integrations/runs?sync=0"), env, {}).then((response) => response.json());
    const original = activePayload.runs.find((run) => run.id === launch.runId);
    assert.equal(original.actions.cancel, true);
    assert.equal(original.actions.rerun, false);

    const cancelResponse = await worker.fetch(new Request(`https://dashboard.test/api/integrations/runs/${launch.runId}/cancel`, { method: "POST" }), env, {});
    assert.equal(cancelResponse.status, 200);
    assert.equal(abortedJob, "job_1");

    const cancelledPayload = await worker.fetch(new Request("https://dashboard.test/api/integrations/runs?sync=0"), env, {}).then((response) => response.json());
    const cancelled = cancelledPayload.runs.find((run) => run.id === launch.runId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.actions.cancel, false);
    assert.equal(cancelled.actions.rerun, true);

    const rerunResponse = await worker.fetch(new Request(`https://dashboard.test/api/integrations/runs/${launch.runId}/rerun`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    }), env, {});
    assert.equal(rerunResponse.status, 202);
    const rerun = await rerunResponse.json();
    assert.equal(rerun.jobId, "job_2");
    assert.deepEqual(launches[1].workflowData, { database: "billing" });
    const rerunReplay = db.replays.find((row) => row.run_id === rerun.runId);
    assert.equal(rerunReplay.parent_run_id, launch.runId);

    schemaDrift = true;
    const driftResponse = await worker.fetch(new Request(`https://dashboard.test/api/integrations/runs/${launch.runId}/rerun`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    }), env, {});
    assert.equal(driftResponse.status, 409);
    assert.equal((await driftResponse.json()).schemaChanged, true);

    const secretResponse = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "secret-job", values: { token: "must-not-persist" } }),
    }), env, {});
    assert.equal(secretResponse.status, 202);
    const secretRun = await secretResponse.json();
    const secretReplay = db.replays.find((row) => row.run_id === secretRun.runId);
    assert.equal(secretReplay.replayable, 0);
    assert.equal(secretReplay.encrypted_spec, null);
    assert.doesNotMatch(JSON.stringify(secretReplay), /must-not-persist/);
    const secretList = await worker.fetch(new Request("https://dashboard.test/api/integrations/runs?sync=0"), env, {}).then((response) => response.json());
    const secret = secretList.runs.find((run) => run.id === secretRun.runId);
    assert.equal(secret.actions.rerun, false);
    assert.match(secret.actions.reason, /секретным/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
