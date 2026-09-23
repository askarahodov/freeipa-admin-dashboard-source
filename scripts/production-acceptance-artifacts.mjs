import fs from "node:fs/promises";
import path from "node:path";

import { assertProductionAcceptanceReportSafe } from "./production-acceptance-contract.mjs";

export const DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS = 604_800;
const MAX_RETENTION_SECONDS = 31_536_000;
const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/u;

export function normalizeProductionAcceptanceRetentionSeconds(value, fallback = DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS) {
  const candidate = value === undefined || value === null || String(value).trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_RETENTION_SECONDS) {
    throw new Error("acceptance_retention_seconds_invalid");
  }
  return candidate;
}

export function productionAcceptanceRunId(startedAt) {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("acceptance_report_started_at_invalid");
  return date.toISOString().replace(/[:.]/gu, "-");
}

export async function pruneProductionAcceptanceHistory(
  historyDirectory,
  {
    retentionSeconds = DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS,
    nowMs = Date.now(),
  } = {},
) {
  const retention = normalizeProductionAcceptanceRetentionSeconds(retentionSeconds);
  await fs.mkdir(historyDirectory, { recursive: true });
  const entries = await fs.readdir(historyDirectory, { withFileTypes: true });
  const removed = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name)) continue;
    const directory = path.join(historyDirectory, entry.name);
    const stats = await fs.stat(directory);
    if (nowMs - stats.mtimeMs <= retention * 1_000) continue;
    await fs.rm(directory, { recursive: true, force: true });
    removed.push(entry.name);
  }

  return Object.freeze(removed.sort());
}

export async function writeProductionAcceptanceArtifacts({
  report,
  html,
  outputDirectory,
  historyDirectory,
  retentionSeconds = DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS,
  nowMs = Date.now(),
}) {
  if (!report || typeof report !== "object") throw new Error("acceptance_report_invalid");
  if (typeof html !== "string") throw new Error("acceptance_report_html_invalid");
  assertProductionAcceptanceReportSafe({ report, html });

  const runId = productionAcceptanceRunId(report.timing?.startedAt);
  const runDirectory = path.join(historyDirectory, runId);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  const removed = await pruneProductionAcceptanceHistory(historyDirectory, {
    retentionSeconds,
    nowMs,
  });

  await Promise.all([
    fs.mkdir(outputDirectory, { recursive: true }),
    fs.mkdir(runDirectory, { recursive: true }),
  ]);

  await Promise.all([
    fs.writeFile(path.join(outputDirectory, "report.json"), serialized),
    fs.writeFile(path.join(outputDirectory, "report.html"), html),
    fs.writeFile(path.join(runDirectory, "report.json"), serialized),
    fs.writeFile(path.join(runDirectory, "report.html"), html),
  ]);

  return Object.freeze({
    runId,
    runDirectory,
    removed,
  });
}
