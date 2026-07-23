import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class SyncD1 {
  snapshot = null;
  history = [];
  locks = new Map();
  syncRuns = new Map();

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("DELETE FROM xyops_catalog_sync_lock WHERE id = ? AND acquired_at < ?")) {
          const current = this.locks.get(values[0]);
          if (current !== undefined && current < values[1]) this.locks.delete(values[0]);
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith("INSERT OR IGNORE INTO xyops_catalog_sync_lock")) {
          if (this.locks.has(values[0])) return { meta: { changes: 0 } };
          this.locks.set(values[0], values[1]);
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM xyops_catalog_sync_lock WHERE id = ? AND acquired_at = ?")) {
          if (this.locks.get(values[0]) === values[1]) this.locks.delete(values[0]);
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO xyops_catalog_sync_runs")) {
          this.syncRuns.set(values[0], {
            id: values[0], trigger_name: values[1], status: values[2], started_at: values[3],
            completed_at: values[4], process_count: values[5], change_count: values[6], error: values[7],
          });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO xyops_catalog_snapshot")) {
          this.snapshot = { catalog_json: values[1], synced_at: values[2] };
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO xyops_catalog_history")) {
          this.history.push({ id: values[0], synced_at: values[1], changes_json: values[2], catalog_json: values[3] });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
      first: async () => {
        if (sql.startsWith("SELECT config_json")) return null;
        if (sql.startsWith("SELECT catalog_json")) return this.snapshot;
        if (sql.startsWith("SELECT acquired_at")) return this.locks.has(values[0]) ? { acquired_at: this.locks.get(values[0]) } : null;
        return null;
      },
      all: async () => {
        if (sql.startsWith("SELECT id, trigger_name")) {
          return { results: [...this.syncRuns.values()].sort((a, b) => b.started_at - a.started_at).slice(0, Number(values[0] ?? 20)) };
        }
        return { results: [] };
      },
    };
    return statement;
  }
}

function adminEnv(db, values = {}) {
  return {
    DB: db,
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "secret",
    ADMIN_TOKEN: "admin-token",
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: "admin@example.test",
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "admin@example.test": "admin" }),
    ...values,
  };
}

function context(capture) {
  return { waitUntil(promise) { capture.promise = promise; }, passThroughOnException() {} };
}

test("scheduled handler synchronizes the XYOps catalog and records success", async () => {
  const originalFetch = globalThis.fetch;
  const db = new SyncD1();
  let calls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/get_events/v1")) {
      calls += 1;
      return Response.json({ events: [{ id: "backup", title: "Backup", type: "workflow", category: "Databases" }] });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const capture = {};
    await worker.scheduled({ cron: "0 * * * *", scheduledTime: Date.now() }, adminEnv(db), context(capture));
    await capture.promise;

    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(db.snapshot.catalog_json).map((event) => event.id), ["backup"]);
    assert.equal(db.history.length, 1);

    const response = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/sync", {
      headers: { "x-admin-token": "admin-token" },
    }), adminEnv(db), context({}));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.runs[0].status, "success");
    assert.equal(payload.runs[0].trigger, "cron:0 * * * *");
    assert.equal(payload.runs[0].processCount, 1);
    assert.equal(payload.runs[0].changeCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("D1 lock skips an overlapping scheduled synchronization", async () => {
  const originalFetch = globalThis.fetch;
  const db = new SyncD1();
  db.locks.set("catalog", Date.now());
  globalThis.fetch = async () => { throw new Error("network must not be called"); };

  try {
    const capture = {};
    await worker.scheduled({ cron: "0 * * * *" }, adminEnv(db), context(capture));
    await capture.promise;
    const runs = [...db.syncRuns.values()];
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "skipped");
    assert.match(runs[0].error, /уже выполняется/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automatic synchronization can be disabled without removing cron", async () => {
  const db = new SyncD1();
  const capture = {};
  await worker.scheduled({ cron: "0 * * * *" }, adminEnv(db, { XYOPS_CATALOG_SYNC_ENABLED: "false" }), context(capture));
  assert.equal(capture.promise, undefined);
  assert.equal(db.syncRuns.size, 0);
});

test("manual synchronization requires admin role and ADMIN_TOKEN", async () => {
  const db = new SyncD1();
  const viewer = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/sync", {
    method: "POST", headers: { "x-admin-token": "admin-token" },
  }), { ...adminEnv(db), PORTAL_RBAC_JSON: JSON.stringify({ "admin@example.test": "viewer" }) }, context({}));
  assert.equal(viewer.status, 403);

  const missingToken = await worker.fetch(new Request("https://dashboard.test/api/integrations/catalog/sync", { method: "POST" }), adminEnv(db), context({}));
  assert.equal(missingToken.status, 401);
});
