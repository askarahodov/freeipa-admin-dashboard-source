import assert from "node:assert/strict";
import test from "node:test";

import { collectShape, inspectXyops, sanitize } from "../scripts/xyops-inspect.mjs";

test("inspector preserves contracts while redacting secrets and identities", async () => {
  const payload = { events: [{ id: "event-secret-id", title: "Production DB Backup", enabled: true, user_fields: [{ id: "database", type: "menu", required: true, options: ["billing", "crm"], api_key: "must-not-leak" }] }] };
  const report = await inspectXyops({
    baseUrl: "https://xyops.internal.example",
    apiKey: "top-secret-api-key",
    probes: [{ name: "events", path: "/api/app/get_events/v1", required: true }],
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers["x-api-key"], "top-secret-api-key");
      return Response.json(payload);
    },
  });

  assert.equal(report.summary.succeeded, 1);
  assert.equal(report.target.host, "[REDACTED_HOST]");
  assert.equal(report.results[0].sample.events.$items[0].id, "<string:15>");
  assert.equal(report.results[0].sample.events.$items[0].user_fields.$items[0].type, "menu");
  assert.equal(report.results[0].sample.events.$items[0].user_fields.$items[0].api_key, "[REDACTED]");
  assert.ok(report.results[0].shape.some((entry) => entry.path === "$.events[].user_fields[].type"));
  assert.doesNotMatch(JSON.stringify(report), /top-secret-api-key|must-not-leak|Production DB Backup|xyops\.internal/);
});

test("standalone helpers report array shape and optionally retain names", () => {
  assert.deepEqual(sanitize({ title: "Backup", type: "workflow", callback_url: "https://example.test/path?token=secret" }, { includeNames: true }), { title: "Backup", type: "workflow", callback_url: "[REDACTED_URL]" });
  assert.deepEqual(collectShape({ rows: [{ enabled: true }] }).map((entry) => entry.path), ["$", "$.rows", "$.rows[]", "$.rows[].enabled"]);
});
