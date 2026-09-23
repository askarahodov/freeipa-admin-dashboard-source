import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS,
  normalizeProductionAcceptanceRetentionSeconds,
  productionAcceptanceRunId,
  pruneProductionAcceptanceHistory,
  writeProductionAcceptanceArtifacts,
} from "../../scripts/production-acceptance-artifacts.mjs";

test("production acceptance retention defaults to seven days and rejects unbounded values", () => {
  assert.equal(normalizeProductionAcceptanceRetentionSeconds(undefined), DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS);
  assert.equal(normalizeProductionAcceptanceRetentionSeconds("3600"), 3600);
  assert.throws(() => normalizeProductionAcceptanceRetentionSeconds("0"), /acceptance_retention_seconds_invalid/u);
  assert.throws(() => normalizeProductionAcceptanceRetentionSeconds("999999999"), /acceptance_retention_seconds_invalid/u);
});

test("production acceptance run IDs are deterministic and path-safe", () => {
  assert.equal(
    productionAcceptanceRunId("2026-09-23T08:00:01.234Z"),
    "2026-09-23T08-00-01-234Z",
  );
  assert.throws(() => productionAcceptanceRunId("not-a-date"), /acceptance_report_started_at_invalid/u);
});

test("artifact writer keeps latest evidence, archives the run and removes only expired managed run directories", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-acceptance-artifacts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const outputDirectory = path.join(root, "latest");
  const historyDirectory = path.join(root, "runs");
  const oldManaged = path.join(historyDirectory, "2026-09-20T08-00-00-000Z");
  const unmanaged = path.join(historyDirectory, "manual-notes");
  await fs.mkdir(oldManaged, { recursive: true });
  await fs.mkdir(unmanaged, { recursive: true });
  const oldTime = new Date("2026-09-20T08:00:00.000Z");
  await fs.utimes(oldManaged, oldTime, oldTime);

  const report = {
    schemaVersion: 1,
    outcome: "passed",
    timing: { startedAt: "2026-09-23T08:00:01.234Z" },
  };
  const result = await writeProductionAcceptanceArtifacts({
    report,
    html: "<html>safe</html>\n",
    outputDirectory,
    historyDirectory,
    retentionSeconds: 86_400,
    nowMs: new Date("2026-09-23T08:00:02.000Z").getTime(),
  });

  assert.deepEqual(result.removed, ["2026-09-20T08-00-00-000Z"]);
  assert.equal(await fs.readFile(path.join(outputDirectory, "report.json"), "utf8"), `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(await fs.readFile(path.join(result.runDirectory, "report.html"), "utf8"), "<html>safe</html>\n");
  await fs.access(unmanaged);
  await assert.rejects(fs.access(oldManaged));
});

test("artifact writer refuses unsafe report or HTML before persisting evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-acceptance-unsafe-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    writeProductionAcceptanceArtifacts({
      report: {
        schemaVersion: 1,
        outcome: "failed",
        timing: { startedAt: "2026-09-23T08:00:01.234Z" },
        detail: "authorization: Bearer hidden",
      },
      html: "<html>safe</html>",
      outputDirectory: path.join(root, "latest"),
      historyDirectory: path.join(root, "runs"),
    }),
    /acceptance_report_redaction_failed/u,
  );

  await assert.rejects(
    writeProductionAcceptanceArtifacts({
      report: {
        schemaVersion: 1,
        outcome: "passed",
        timing: { startedAt: "2026-09-23T08:00:01.234Z" },
      },
      html: "<html>http://internal.example.test</html>",
      outputDirectory: path.join(root, "latest"),
      historyDirectory: path.join(root, "runs"),
    }),
    /acceptance_report_redaction_failed/u,
  );

  await assert.rejects(fs.access(path.join(root, "latest", "report.json")));
});

test("history pruning ignores files and unmanaged directory names", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-acceptance-prune-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "2026-09-20T08-00-00-000Z"), "not a directory");
  await fs.mkdir(path.join(root, "custom-folder"));
  const removed = await pruneProductionAcceptanceHistory(root, {
    retentionSeconds: 1,
    nowMs: Date.now() + 10_000,
  });
  assert.deepEqual(removed, []);
});
