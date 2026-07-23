import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class ApprovalD1 {
  approvalPolicy = null;
  approvals = [];
  decisions = [];
  runs = [];
  replays = [];
  audits = [];

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO approval_policy_sets")) {
          this.approvalPolicy = { policy_json: values[1], updated_at: values[2] };
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO operation_approvals")) {
          this.approvals.push({
            id: values[0], event_id: values[1], title: values[2], category: values[3], schema_version: values[4],
            requester_identity: values[5], requester_role: values[6], requester_groups_json: values[7], status: "pending",
            required_approvals: values[8], approver_roles_json: values[9], approver_groups_json: values[10], requester_cannot_approve: values[11],
            rule_id: values[12], summary_json: values[13], encrypted_spec: values[14], request_fingerprint: values[15], expires_at: values[16],
            created_at: values[17], updated_at: values[18], approved_at: null, executed_at: null, run_id: null, parent_run_id: values[19], error: null,
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO operation_approval_decisions")) {
          const [approvalId, identity, role, decision, comment, decidedAt] = values;
          if (this.decisions.some((row) => row.approval_id === approvalId && row.approver_identity === identity)) throw new Error("duplicate");
          this.decisions.push({ approval_id: approvalId, approver_identity: identity, approver_role: role, decision, comment, decided_at: decidedAt });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE operation_approvals SET status = 'expired'")) {
          const [updatedAt, expiresAt] = values;
          let changes = 0;
          for (const row of this.approvals) if (["pending", "approved"].includes(row.status) && row.expires_at <= expiresAt) { row.status = "expired"; row.updated_at = updatedAt; changes += 1; }
          return { success: true, meta: { changes } };
        }
        if (sql.startsWith("UPDATE operation_approvals SET status = 'rejected'")) {
          const [updatedAt, error, id] = values; const row = this.approvals.find((item) => item.id === id && item.status === "pending");
          if (row) { row.status = "rejected"; row.updated_at = updatedAt; row.error = error; }
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        if (sql.startsWith("UPDATE operation_approvals SET status = 'approved'")) {
          const [approvedAt, updatedAt, id] = values; const row = this.approvals.find((item) => item.id === id && item.status === "pending");
          if (row) { row.status = "approved"; row.approved_at = approvedAt; row.updated_at = updatedAt; }
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        if (sql.startsWith("UPDATE operation_approvals SET status = 'cancelled'")) {
          const [updatedAt, id] = values; const row = this.approvals.find((item) => item.id === id && ["pending", "approved"].includes(item.status));
          if (row) { row.status = "cancelled"; row.updated_at = updatedAt; }
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        if (sql.startsWith("UPDATE operation_approvals SET status = 'executing'")) {
          const [updatedAt, id, now] = values; const row = this.approvals.find((item) => item.id === id && item.status === "approved" && item.expires_at > now);
          if (row) { row.status = "executing"; row.updated_at = updatedAt; }
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        if (sql.startsWith("UPDATE operation_approvals SET status = ?")) {
          const [status, runId, error, executedAt, updatedAt, id] = values; const row = this.approvals.find((item) => item.id === id && item.status === "executing");
          if (row) { row.status = status; row.run_id = runId; row.error = error; row.executed_at = executedAt; row.updated_at = updatedAt; }
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        if (sql.startsWith("INSERT INTO portal_audit_events")) {
          this.audits.push({ id: values[0], created_at: values[1], correlation_id: values[2], actor_identity: values[3], actor_role: values[4], actor_groups_json: values[5], action: values[6], resource_type: values[7], resource_id: values[8], event_id: values[9], schema_version: values[10], approval_id: values[11], run_id: values[12], job_id: values[13], outcome: values[14], error_code: values[15], metadata_json: values[16] });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO operation_runs")) {
          const row = { id: values[0], job_id: values[1], event_id: values[2], title: values[3], kind: values[4], mode: values[5], status: values[6], actor: values[7], subject: values[8], error: values[9], stages_json: values[10], started_at: values[11], updated_at: values[12], completed_at: values[13] };
          const index = this.runs.findIndex((item) => item.id === row.id); if (index >= 0) this.runs[index] = { ...this.runs[index], ...row }; else this.runs.push(row);
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO operation_run_replays")) {
          const row = { run_id: values[0], event_id: values[1], schema_version: values[2], encrypted_spec: values[3], replayable: values[4], reason: values[5], parent_run_id: values[6], created_at: values[7] };
          const index = this.replays.findIndex((item) => item.run_id === row.run_id); if (index >= 0) this.replays[index] = row; else this.replays.push(row);
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      first: async () => {
        if (sql.includes("FROM approval_policy_sets")) return this.approvalPolicy;
        if (sql.includes("FROM catalog_visibility_policies")) return null;
        if (sql.startsWith("SELECT * FROM operation_approvals WHERE id")) return this.approvals.find((row) => row.id === values[0]) ?? null;
        if (sql.includes("COUNT(*) AS approvals") && sql.includes("operation_approval_decisions")) return { approvals: this.decisions.filter((row) => row.approval_id === values[0] && row.decision === "approve").length };
        if (sql.includes("FROM operation_run_replays WHERE run_id =")) return this.replays.find((row) => row.run_id === values[0]) ?? null;
        if (sql.includes("FROM portal_audit_events WHERE approval_id")) return this.audits.find((row) => row.approval_id === values[0]) ?? null;
        if (sql.includes("FROM portal_audit_events WHERE run_id")) return this.audits.find((row) => row.run_id === values[0]) ?? null;
        if (sql.includes("COUNT(*) AS unread")) return { unread: 0 };
        return null;
      },
      all: async () => {
        if (sql.startsWith("SELECT * FROM operation_approvals ORDER BY")) return { results: [...this.approvals].sort((a, b) => b.created_at - a.created_at).slice(0, Number(values[0] ?? 100)) };
        if (sql.includes("FROM operation_approval_decisions WHERE approval_id IN")) return { results: this.decisions.filter((row) => values.includes(row.approval_id)).sort((a, b) => a.decided_at - b.decided_at) };
        if (sql.includes("FROM operation_runs ORDER BY")) return { results: [...this.runs].sort((a, b) => b.started_at - a.started_at).slice(0, Number(values[0] ?? 100)) };
        if (sql.includes("FROM operation_run_replays WHERE run_id IN")) return { results: this.replays.filter((row) => values.includes(row.run_id)) };
        if (sql.includes("FROM operation_run_results WHERE run_id IN")) return { results: [] };
        if (sql.startsWith("SELECT n.id") && sql.includes("operation_notifications")) return { results: [] };
        if (sql.startsWith("SELECT id FROM operation_notifications")) return { results: [] };
        if (sql.includes("FROM portal_audit_events")) return { results: [...this.audits].sort((a, b) => b.created_at - a.created_at).slice(0, Number(values.at(-1) ?? 200)) };
        return { results: [] };
      },
    };
    return statement;
  }
}

function envFor(db, identity) {
  return {
    DB: db,
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "xyops-secret",
    CONFIG_ENCRYPTION_KEY: "33".repeat(32),
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "operator@example.test": "operator", "admin@example.test": "admin" }),
    XYOPS_ROUTES_JSON: JSON.stringify([{ key: "dangerous-route", title: "Dangerous secret", operation: "user_disable", kind: "event", eventId: "dangerous-secret", enabled: true, targets: ["prod-01"], fields: [{ key: "database", label: "Database", type: "string", required: true, target: "params" }, { key: "password", label: "Password", type: "password", required: true, target: "params" }] }]),
  };
}

async function request(env, path, body) {
  return worker.fetch(new Request(`https://portal.test${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
}

test("requires independent one-time approval before dangerous XYOps execution", async () => {
  const originalFetch = globalThis.fetch;
  const db = new ApprovalD1();
  const launches = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json({ events: [
      { id: "dangerous-secret", title: "Dangerous secret", category: "Production", dangerous: true, targets: ["prod-01"], user_fields: [{ id: "database", title: "Database", required: true }, { id: "password", title: "Password", type: "password", required: true }] },
      { id: "dangerous-repeat", title: "Dangerous repeat", category: "Production", requires_confirmation: true, user_fields: [{ id: "database", title: "Database", required: true }] },
    ] });
    if (url.pathname.endsWith("/run_event/v1")) { const payload = JSON.parse(String(init.body ?? "{}")); launches.push(payload); return Response.json({ id: `job_approval_${launches.length}`, status: "queued" }); }
    if (url.pathname.endsWith("/get_active_jobs/v1")) return Response.json({ code: 0, rows: [] });
    if (url.pathname.endsWith("/get_jobs/v1")) return Response.json({ code: 0, jobs: [] });
    return new Response("not found", { status: 404 });
  };

  try {
    const operator = envFor(db, "operator@example.test");
    const admin = envFor(db, "admin@example.test");

    let response = await request(operator, "/api/integrations/catalog/run", { eventId: "dangerous-secret", values: { database: "billing", password: "first-secret" }, targets: ["prod-01"] });
    assert.equal(response.status, 202);
    let payload = await response.json();
    assert.equal(payload.approvalRequired, true);
    assert.equal(launches.length, 0, "run_event must not be called before approval");
    const secretApprovalId = payload.approvalId;
    assert.doesNotMatch(JSON.stringify(payload), /first-secret|xyops-secret/);
    assert.deepEqual(payload.approval.summary.secretFields, [{ key: "password", label: "Password" }]);

    response = await request(operator, `/api/integrations/approvals/${secretApprovalId}/approve`, {});
    assert.equal(response.status, 403, "operator/requester cannot approve own request");

    response = await request(admin, `/api/integrations/approvals/${secretApprovalId}/approve`, { comment: "Reviewed" });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.approval.status, "approved");

    response = await request(operator, `/api/integrations/approvals/${secretApprovalId}/execute`, { secretValues: { password: "execution-secret" } });
    assert.equal(response.status, 202);
    payload = await response.json();
    assert.equal(payload.approvalExecuted, true);
    assert.equal(launches.length, 1);
    assert.equal(launches[0].params.password, "execution-secret");
    assert.notEqual(launches[0].params.password, "first-secret");
    const firstRunId = payload.runId;

    response = await request(operator, `/api/integrations/approvals/${secretApprovalId}/execute`, { secretValues: { password: "another-secret" } });
    assert.equal(response.status, 409);
    assert.equal(launches.length, 1, "approval cannot be reused");

    response = await request(operator, "/api/integrations/actions", { operation: "user_disable", routeKey: "dangerous-route", database: "billing", password: "route-secret" });
    assert.equal(response.status, 202);
    payload = await response.json();
    assert.equal(payload.approvalRequired, true, "legacy route endpoint must use the approval gate");
    assert.equal(launches.length, 1);

    response = await request(operator, "/api/integrations/catalog/run", { eventId: "dangerous-repeat", values: { database: "audit" }, targets: [] });
    payload = await response.json();
    const repeatApprovalId = payload.approvalId;
    await request(admin, `/api/integrations/approvals/${repeatApprovalId}/approve`, {});
    response = await request(operator, `/api/integrations/approvals/${repeatApprovalId}/execute`, { secretValues: {} });
    payload = await response.json();
    assert.equal(response.status, 202);
    const repeatRunId = payload.runId;
    assert.equal(launches.length, 2);
    const completedRepeatRun = db.runs.find((item) => item.id === repeatRunId);
    assert.ok(completedRepeatRun);
    completedRepeatRun.status = "success";
    completedRepeatRun.completed_at = Date.now();
    completedRepeatRun.updated_at = completedRepeatRun.completed_at;

    response = await request(operator, `/api/integrations/runs/${repeatRunId}/rerun`, { confirm: true });
    assert.equal(response.status, 202);
    payload = await response.json();
    assert.equal(payload.approvalRequired, true, "safe re-run of dangerous process needs a new approval");
    assert.notEqual(payload.approvalId, repeatApprovalId);
    assert.equal(launches.length, 2);

    response = await request(operator, "/api/integrations/approvals");
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.ok(payload.approvals.some((item) => item.id === secretApprovalId && item.status === "executed" && item.runId === firstRunId));
    assert.doesNotMatch(JSON.stringify(payload), /execution-secret|first-secret|route-secret|xyops-secret/);
    const chain = db.audits.filter((item) => item.approval_id === secretApprovalId || item.run_id === firstRunId);
    assert.ok(chain.some((item) => item.action === "approval.requested"));
    assert.ok(chain.some((item) => item.action === "approval.approve"));
    assert.ok(chain.some((item) => item.action === "approval.execute"));
    assert.ok(chain.some((item) => item.action === "xyops.run"));
    assert.equal(new Set(chain.map((item) => item.correlation_id)).size, 1, "approval and run must share the root correlation ID");
    assert.doesNotMatch(JSON.stringify(db.audits), /execution-secret|first-secret|route-secret|xyops-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
