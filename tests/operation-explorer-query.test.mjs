import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOperationTimeline,
  formatOperationDuration,
  normalizeOperationQuery,
  queryOperationRuns,
} from "../src/operations/explorer/operation-explorer.ts";

function run(values = {}) {
  return {
    id: values.id ?? "run-1",
    jobId: values.jobId ?? "job-1",
    eventId: values.eventId ?? "backup-db",
    title: values.title ?? "Backup database",
    kind: values.kind ?? "workflow",
    mode: values.mode ?? "live",
    status: values.status ?? "success",
    actor: values.actor ?? "operator@example.test",
    subject: values.subject ?? "billing",
    error: values.error ?? null,
    stages: values.stages ?? [],
    startedAt: values.startedAt ?? new Date("2026-07-20T12:00:00").getTime(),
    updatedAt: values.updatedAt ?? new Date("2026-07-20T12:05:00").getTime(),
    completedAt: values.completedAt === undefined ? new Date("2026-07-20T12:05:00").getTime() : values.completedAt,
  };
}

test("normalizes operation filters and rejects unsupported values", () => {
  const query = normalizeOperationQuery(new URLSearchParams("q=backup&status=active&actor=operator&from=2026-07-01&to=2026-07-31&sort=duration_desc&page=3&pageSize=50"));
  assert.deepEqual(query, {
    q: "backup",
    status: "active",
    actor: "operator",
    from: "2026-07-01",
    to: "2026-07-31",
    sort: "duration_desc",
    page: 3,
    pageSize: 50,
  });

  const fallback = normalizeOperationQuery(new URLSearchParams("status=broken&from=20-07-2026&sort=broken&page=-2&pageSize=17"));
  assert.deepEqual(fallback, {
    q: "",
    status: "all",
    actor: "",
    from: "",
    to: "",
    sort: "started_desc",
    page: 1,
    pageSize: 25,
  });
});

test("filters by process, actor, status and local date before pagination", () => {
  const runs = [
    run({ id: "1", jobId: "job-backup", status: "running", completedAt: null, actor: "operator@example.test", startedAt: new Date("2026-07-20T12:00:00").getTime() }),
    run({ id: "2", jobId: "job-restore", eventId: "restore-db", title: "Restore database", status: "success", actor: "admin@example.test", startedAt: new Date("2026-07-20T13:00:00").getTime() }),
    run({ id: "3", jobId: "job-old", status: "failed", actor: "operator@example.test", startedAt: new Date("2026-07-19T12:00:00").getTime() }),
  ];
  const result = queryOperationRuns(runs, {
    q: "backup",
    status: "active",
    actor: "operator",
    from: "2026-07-20",
    to: "2026-07-20",
    sort: "started_desc",
    page: 1,
    pageSize: 10,
  }, new Date("2026-07-20T12:10:00").getTime());

  assert.deepEqual(result.runs.map((item) => item.jobId), ["job-backup"]);
  assert.deepEqual(result.pagination, { page: 1, pageSize: 10, total: 1, totalPages: 1, from: 1, to: 1 });
  assert.deepEqual(result.summary, { total: 3, filtered: 1, active: 1, queued: 0, running: 1, success: 1, failed: 1, cancelled: 0, unknown: 0 });
  assert.deepEqual(result.options.actors, ["admin@example.test", "operator@example.test"]);
});

test("sorts by duration and clamps requested page", () => {
  const start = new Date("2026-07-20T12:00:00").getTime();
  const result = queryOperationRuns([
    run({ id: "short", jobId: "job-short", startedAt: start, updatedAt: start + 10_000, completedAt: start + 10_000 }),
    run({ id: "long", jobId: "job-long", startedAt: start + 1_000, updatedAt: start + 61_000, completedAt: start + 61_000 }),
    run({ id: "middle", jobId: "job-middle", startedAt: start + 2_000, updatedAt: start + 32_000, completedAt: start + 32_000 }),
  ], {
    q: "",
    status: "finished",
    actor: "",
    from: "",
    to: "",
    sort: "duration_desc",
    page: 9,
    pageSize: 10,
  }, start + 100_000);

  assert.deepEqual(result.runs.map((item) => item.jobId), ["job-long", "job-middle", "job-short"]);
  assert.equal(result.pagination.page, 1);
});

test("builds detailed stage durations and waiting intervals", () => {
  const timeline = buildOperationTimeline(run({
    startedAt: 1_000,
    updatedAt: 11_000,
    completedAt: 11_000,
    stages: [
      { id: "prepare", title: "Prepare", status: "success", startedAt: 1_000, completedAt: 3_000, error: "" },
      { id: "backup", title: "Backup", status: "success", startedAt: 5_000, completedAt: 9_000, error: "" },
    ],
  }), 20_000);

  assert.equal(timeline.totalDurationMs, 10_000);
  assert.deepEqual(timeline.stages.map((stage) => ({ durationMs: stage.durationMs, waitingMs: stage.waitingMs, offsetMs: stage.offsetMs })), [
    { durationMs: 2_000, waitingMs: 0, offsetMs: 0 },
    { durationMs: 4_000, waitingMs: 2_000, offsetMs: 4_000 },
  ]);
  assert.equal(formatOperationDuration(10_000), "10 с");
  assert.equal(formatOperationDuration(61_000), "1 мин 1 с");
});
