import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class AuditD1 {
  audits = [];
  runs = [];

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO portal_audit_events")) {
          this.audits.push({
            id: values[0], created_at: values[1], correlation_id: values[2], actor_identity: values[3], actor_role: values[4], actor_groups_json: values[5],
            action: values[6], resource_type: values[7], resource_id: values[8], event_id: values[9], schema_version: values[10], approval_id: values[11],
            run_id: values[12], job_id: values[13], outcome: values[14], error_code: values[15], metadata_json: values[16],
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO operation_runs")) {
          this.runs.push({ id: values[0], job_id: values[1], event_id: values[2], title: values[3], kind: values[4], mode: values[5], status: values[6], actor: values[7], subject: values[8], error: values[9], stages_json: values[10], started_at: values[11], updated_at: values[12], completed_at: values[13] });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      first: async () => {
        if (sql.includes("FROM portal_audit_events WHERE run_id")) return this.audits.find((row) => row.run_id === values[0]) ?? null;
        if (sql.includes("FROM portal_audit_events WHERE approval_id")) return this.audits.find((row) => row.approval_id === values[0]) ?? null;
        if (sql.includes("COUNT(*) AS unread")) return { unread: 0 };
        return null;
      },
      all: async () => {
        if (sql.includes("FROM portal_audit_events")) return { results: [...this.audits].sort((a, b) => b.created_at - a.created_at).slice(0, Number(values.at(-1) ?? 200)) };
        if (sql.includes("FROM operation_runs ORDER BY")) return { results: [...this.runs] };
        if (sql.startsWith("SELECT n.id") || sql.startsWith("SELECT id FROM operation_notifications")) return { results: [] };
        if (sql.includes("FROM operation_run_replays") || sql.includes("FROM operation_run_results")) return { results: [] };
        return { results: [] };
      },
    };
    return statement;
  }
}

function envFor(db, identity, role) {
  return {
    DB: db,
    DEMO_MODE: "true",
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ [identity]: role }),
  };
}

async function call(env, path, options = {}) {
  return worker.fetch(new Request(`https://portal.test${path}`, options), env, {});
}

test("records sanitized server-generated audit events and protects the audit API", async () => {
  const db = new AuditD1();
  const admin = envFor(db, "admin@example.test", "admin");
  const operator = envFor(db, "operator@example.test", "operator");
  const secret = "audit-password-123";
  const spoofed = "cor_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  let response = await call(admin, "/api/integrations/freeipa/actions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-portal-correlation-id": spoofed },
    body: JSON.stringify({ operation: "user_password", uid: "alice", password: secret }),
  });
  assert.equal(response.status, 200);
  const mutation = await response.json();
  assert.ok(mutation.runId);

  response = await call(admin, "/api/integrations/audit?limit=50");
  assert.equal(response.status, 200);
  const payload = await response.json();
  const event = payload.events.find((item) => item.action === "freeipa.user_password");
  assert.ok(event);
  assert.equal(event.actorIdentity, "admin@example.test");
  assert.equal(event.actorRole, "admin");
  assert.equal(event.runId, mutation.runId);
  assert.match(event.correlationId, /^cor_[a-z0-9]{20,92}$/i);
  assert.notEqual(event.correlationId, spoofed, "client headers cannot choose the server correlation ID");
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(secret));
  assert.deepEqual(event.metadata.fieldKeys, ["uid"]);

  response = await call(operator, "/api/integrations/audit");
  assert.equal(response.status, 403);

  response = await call(admin, "/api/integrations/audit", { method: "POST" });
  assert.equal(response.status, 405, "audit API must not expose mutation operations");
});
