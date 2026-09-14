import assert from "node:assert/strict";
import test from "node:test";

import {
  extractJobStages,
  listOperationRuns,
  publicRun,
  runStatus,
  xyopsPayloadSucceeded,
} from "../../worker/xyops-run-runtime.ts";

function fakeDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM operation_runs ORDER BY started_at DESC LIMIT/);
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async all() { return { results: rows.slice(0, Number(values[0] ?? 100)) }; },
      };
      return statement;
    },
  };
}

test("shared XYOps run runtime preserves legacy status normalization", () => {
  assert.equal(runStatus("in-progress"), "running");
  assert.equal(runStatus("DONE"), "success");
  assert.equal(runStatus("aborted"), "cancelled");
  assert.equal(runStatus("abort"), "cancelled");
  assert.equal(runStatus("timeout"), "failed");
  assert.equal(runStatus("executing"), "running");
  assert.equal(runStatus("scheduled"), "queued");
  assert.equal(runStatus("unexpected"), "unknown");
  assert.equal(xyopsPayloadSucceeded({ code: 0 }), true);
  assert.equal(xyopsPayloadSucceeded({ code: 12 }), false);
});

test("shared XYOps run runtime reads the existing operation_runs shape", async () => {
  const runs = await listOperationRuns({ DB: fakeDb([{
    id: "run-1", job_id: "job_1", event_id: "backup", title: "Backup", kind: "workflow", mode: "live", status: "completed",
    actor: "operator@example.test", subject: "billing", error: null, stages_json: JSON.stringify([{ id: "s1", title: "Step", status: "success", startedAt: 1, completedAt: 2, error: "" }]),
    started_at: 10, updated_at: 20, completed_at: 30,
  }]) });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "success");
  assert.equal(runs[0].kind, "workflow");
  assert.equal(runs[0].stages[0].id, "s1");
});

test("public run projection preserves action eligibility and never offers FreeIPA rerun", () => {
  const base = {
    id: "run-1", jobId: "job_1", eventId: "backup", title: "Backup", kind: "event", mode: "live", status: "success",
    actor: "operator@example.test", subject: "billing", error: "", stages: [], startedAt: 1, updatedAt: 2, completedAt: 3,
  };
  const replay = { runId: "run-1", eventId: "backup", schemaVersion: "1", replayable: true, reason: "", parentRunId: "" };
  assert.equal(publicRun(base, replay, undefined, true).actions.rerun, true);
  assert.equal(publicRun({ ...base, eventId: "freeipa:user_add" }, replay, undefined, true).actions.rerun, false);
  assert.equal(publicRun({ ...base, status: "running" }, replay, undefined, true).actions.cancel, true);
});


test("shared XYOps run runtime exports stage extraction used by central launch mutations", () => {
  assert.deepEqual(extractJobStages({ stages: [{ id: "prepare", name: "Prepare", status: "done", started_at: "2026-09-14T08:00:00Z", completed_at: "2026-09-14T08:00:05Z" }] }), [{
    id: "prepare",
    title: "Prepare",
    status: "success",
    startedAt: Date.parse("2026-09-14T08:00:00Z"),
    completedAt: Date.parse("2026-09-14T08:00:05Z"),
    error: "",
  }]);
});
