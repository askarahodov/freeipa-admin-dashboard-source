import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class NotificationsD1 {
  runs = [];
  replays = [];
  results = [];
  notifications = [];
  reads = [];

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
        if (sql.startsWith("INSERT OR IGNORE INTO operation_notifications")) {
          if (!this.notifications.some((item) => item.id === values[0] || item.run_id === values[1])) {
            this.notifications.push({ id: values[0], run_id: values[1], status: values[2], title: values[3], message: values[4], created_at: values[5] });
          }
        }
        if (sql.startsWith("INSERT INTO operation_notification_reads")) {
          const [identity, readAt, id] = values;
          if (this.notifications.some((item) => item.id === id)) {
            const index = this.reads.findIndex((item) => item.notification_id === id && item.identity === identity);
            const row = { notification_id: id, identity, read_at: readAt };
            if (index >= 0) this.reads[index] = row;
            else this.reads.push(row);
          }
        }
        return { success: true, meta: { changes: 1 } };
      },
      first: async () => {
        if (sql.includes("COUNT(*) AS unread")) {
          const identity = values[0];
          return { unread: this.notifications.filter((item) => !this.reads.some((read) => read.notification_id === item.id && read.identity === identity)).length };
        }
        return null;
      },
      all: async () => {
        if (sql.includes("FROM operation_runs ORDER BY")) return { results: [...this.runs].sort((a, b) => b.started_at - a.started_at).slice(0, Number(values[0] ?? 100)) };
        if (sql.includes("FROM operation_run_replays WHERE run_id IN")) return { results: this.replays.filter((item) => values.includes(item.run_id)) };
        if (sql.includes("FROM operation_run_results WHERE run_id IN")) return { results: this.results.filter((item) => values.includes(item.run_id)) };
        if (sql.startsWith("SELECT n.id") && sql.includes("operation_notifications")) {
          const identity = values[0];
          const limit = Number(values[1] ?? 50);
          return { results: [...this.notifications].sort((a, b) => b.created_at - a.created_at).slice(0, limit).map((item) => ({ ...item, read_at: this.reads.find((read) => read.notification_id === item.id && read.identity === identity)?.read_at ?? null })) };
        }
        if (sql.startsWith("SELECT id FROM operation_notifications")) return { results: [...this.notifications].sort((a, b) => b.created_at - a.created_at).slice(0, 500).map(({ id }) => ({ id })) };
        return { results: [] };
      },
    };
    return statement;
  }
}

function portalEnv(db) {
  return {
    DB: db,
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "xyops-secret",
    CONFIG_ENCRYPTION_KEY: "22".repeat(32),
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "operator@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator" }),
  };
}

async function launch(env) {
  const response = await worker.fetch(new Request("https://portal.test/api/integrations/catalog/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: "notify-job", values: { database: "billing" } }),
  }), env, {});
  assert.equal(response.status, 202);
  return response.json();
}

test("creates deduplicated per-identity notifications for completed and failed XYOps jobs", async () => {
  const originalFetch = globalThis.fetch;
  const db = new NotificationsD1();
  const terminal = new Map();
  let jobNumber = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [{ id: "notify-job", title: "Database notification test", user_fields: [{ id: "database", title: "Database", required: true }] }] });
    if (url.pathname.endsWith("/run_event/v1")) {
      jobNumber += 1;
      const id = jobNumber === 1 ? "job_notify_success" : "job_notify_failed";
      terminal.set(id, jobNumber === 1 ? { id, completed: 1_784_000_000, code: 0, description: "Backup completed" } : { id, completed: 1_784_000_100, code: 1, description: "Backup failed" });
      return Response.json({ id, status: "queued" });
    }
    if (url.pathname.endsWith("/get_active_jobs/v1")) return Response.json({ code: 0, rows: [] });
    if (url.pathname.endsWith("/get_jobs/v1")) {
      const body = JSON.parse(String(init.body ?? "{}"));
      return Response.json({ code: 0, jobs: body.ids.map((id) => terminal.get(id)).filter(Boolean) });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const env = portalEnv(db);
    await launch(env);
    const firstSync = await worker.fetch(new Request("https://portal.test/api/integrations/runs?sync=1"), env, {});
    assert.equal(firstSync.status, 200);

    let response = await worker.fetch(new Request("https://portal.test/api/integrations/notifications"), env, {});
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.unread, 1);
    assert.equal(payload.notifications.length, 1);
    assert.equal(payload.notifications[0].status, "success");
    assert.match(payload.notifications[0].message, /завершено успешно/);

    await worker.fetch(new Request("https://portal.test/api/integrations/runs?sync=1"), env, {});
    response = await worker.fetch(new Request("https://portal.test/api/integrations/notifications"), env, {});
    payload = await response.json();
    assert.equal(payload.notifications.length, 1, "polling must not duplicate a terminal notification");

    const firstId = payload.notifications[0].id;
    response = await worker.fetch(new Request("https://portal.test/api/integrations/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [firstId] }),
    }), env, {});
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.unread, 0);
    assert.ok(payload.notifications[0].readAt > 0);

    await launch(env);
    await worker.fetch(new Request("https://portal.test/api/integrations/runs?sync=1"), env, {});
    response = await worker.fetch(new Request("https://portal.test/api/integrations/notifications"), env, {});
    payload = await response.json();
    assert.equal(payload.notifications.length, 2);
    assert.equal(payload.unread, 1);
    assert.equal(payload.notifications[0].status, "failed");
    assert.match(payload.notifications[0].message, /с ошибкой/);
    assert.doesNotMatch(JSON.stringify(payload), /xyops-secret|Backup failed/);

    response = await worker.fetch(new Request("https://portal.test/api/integrations/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    }), env, {});
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.unread, 0);
    assert.equal(payload.notifications.every((item) => item.readAt > 0), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
