import assert from "node:assert/strict";
import test from "node:test";
import { parsePortalReadiness, toOverviewOperations } from "../../app/overview/operational-overview-adapter.ts";

test("readiness adapter accepts healthy and unready public readiness payloads", () => {
  assert.deepEqual(parsePortalReadiness({
    state: "unready",
    checks: [
      { name: "database", state: "healthy", code: "ok" },
      { name: "schema", state: "unready", code: "schema_pending" },
      { name: "encryption", state: "healthy", code: "ok" },
      { name: "gateway", state: "healthy", code: "ok" },
    ],
  }), {
    state: "unready",
    checks: [
      { name: "database", state: "healthy", code: "ok" },
      { name: "schema", state: "unready", code: "schema_pending" },
      { name: "encryption", state: "healthy", code: "ok" },
      { name: "gateway", state: "healthy", code: "ok" },
    ],
  });
});

test("readiness adapter rejects malformed or expanded payloads instead of guessing", () => {
  assert.equal(parsePortalReadiness(null), null);
  assert.equal(parsePortalReadiness({ state: "healthy", checks: [{ name: "xyops", state: "healthy", code: "ok" }] }), null);
  assert.equal(parsePortalReadiness({ state: "healthy", checks: [{ name: "database", state: "unknown", code: "ok" }] }), null);
  assert.equal(parsePortalReadiness({ state: "healthy", checks: [{ name: "database", state: "healthy" }] }), null);
});

test("run adapter preserves bounded operation fields and uses the latest known timestamp", () => {
  const [operation] = toOverviewOperations([{
    id: "run-1",
    title: "Directory sync",
    actor: "operator@example.test",
    status: "failed",
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_060_000,
  }]);

  assert.equal(operation.id, "run-1");
  assert.equal(operation.title, "Directory sync");
  assert.equal(operation.actor, "operator@example.test");
  assert.equal(operation.status, "failed");
  assert.equal(operation.timeLabel, new Date(1_700_000_060_000).toLocaleString("ru-RU"));
});
