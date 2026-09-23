import {
  assertProductionAcceptanceReportSafe,
  validateProductionAcceptanceManifest,
} from "./production-acceptance-contract.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function normalizeAcceptanceBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("acceptance_base_url_invalid");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("acceptance_base_url_invalid");
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new Error("acceptance_base_url_not_loopback");
  if (url.username || url.password || url.search || url.hash) throw new Error("acceptance_base_url_invalid");
  return url.origin;
}

function subsetMatches(actual, expected) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((value, index) => subsetMatches(actual[index], value));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => (
      Object.hasOwn(actual, key) && subsetMatches(actual[key], value)
    ));
  }
  return Object.is(actual, expected);
}

export function evaluateProductionAcceptanceCheck(check, response) {
  if (!response || !Number.isInteger(response.status)) {
    return Object.freeze({ passed: false, status: null, code: "request_failed" });
  }
  if (!check.expectedStatus.includes(response.status)) {
    return Object.freeze({ passed: false, status: response.status, code: "status_mismatch" });
  }
  if (!response.jsonValid) {
    return Object.freeze({ passed: false, status: response.status, code: "invalid_json" });
  }
  if (!subsetMatches(response.json, check.requiredJson)) {
    return Object.freeze({ passed: false, status: response.status, code: "json_predicate_mismatch" });
  }
  return Object.freeze({ passed: true, status: response.status, code: "baseline_ok" });
}

function composeDownCommand(manifest) {
  return Object.freeze([
    "docker",
    "compose",
    "--project-name",
    manifest.compose.projectName,
    "--env-file",
    manifest.compose.serviceEnvFile,
    "-f",
    "compose.yaml",
    "down",
    "--volumes",
    "--remove-orphans",
  ]);
}

async function executeProbe(check, { baseUrl, requestJson, now }) {
  const started = now();
  let response;
  try {
    response = await requestJson(new URL(check.path, baseUrl), check.method);
  } catch {
    response = null;
  }
  const evaluated = evaluateProductionAcceptanceCheck(check, response);
  return Object.freeze({
    id: check.id,
    outcome: evaluated.passed ? "passed" : "failed",
    status: evaluated.status,
    code: evaluated.code,
    attempts: 1,
    durationMs: Math.max(0, now() - started),
  });
}

async function waitForReadiness(check, dependencies) {
  const { baseUrl, requestJson, sleep, now, startupTimeoutMs, probeIntervalMs } = dependencies;
  const started = now();
  const deadline = started + startupTimeoutMs;
  let attempts = 0;
  let last = Object.freeze({ passed: false, status: null, code: "request_failed" });

  while (true) {
    attempts += 1;
    let response;
    try {
      response = await requestJson(new URL(check.path, baseUrl), check.method);
    } catch {
      response = null;
    }
    last = evaluateProductionAcceptanceCheck(check, response);
    if (last.passed) {
      return Object.freeze({
        id: check.id,
        outcome: "passed",
        status: last.status,
        code: last.code,
        attempts,
        durationMs: Math.max(0, now() - started),
      });
    }
    if (now() >= deadline) {
      return Object.freeze({
        id: check.id,
        outcome: "failed",
        status: last.status,
        code: "startup_timeout",
        attempts,
        durationMs: Math.max(0, now() - started),
      });
    }
    await sleep(Math.min(probeIntervalMs, Math.max(0, deadline - now())));
  }
}

function isoTimestamp(value) {
  return new Date(value).toISOString();
}

export async function runProductionAcceptance(manifest, options = {}) {
  const validated = validateProductionAcceptanceManifest(manifest);
  const baseUrl = normalizeAcceptanceBaseUrl(options.baseUrl ?? "http://127.0.0.1:3001");
  const runCommand = options.runCommand;
  const requestJson = options.requestJson;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const startupTimeoutMs = Number(options.startupTimeoutMs ?? 120_000);
  const probeIntervalMs = Number(options.probeIntervalMs ?? 2_000);
  const secretValues = Array.isArray(options.secretValues) ? options.secretValues : [];

  if (typeof runCommand !== "function") throw new Error("acceptance_run_command_required");
  if (typeof requestJson !== "function") throw new Error("acceptance_request_json_required");
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) throw new Error("acceptance_startup_timeout_invalid");
  if (!Number.isFinite(probeIntervalMs) || probeIntervalMs <= 0) throw new Error("acceptance_probe_interval_invalid");

  const startedAt = now();
  let startOutcome = "failed";
  let cleanupOutcome = "failed";
  let readiness = null;
  const checks = [];
  const failureCodes = [];

  try {
    try {
      await runCommand(manifest.compose.args[0], manifest.compose.args.slice(1), {
        environment: manifest.compose.environment,
      });
      startOutcome = "passed";
    } catch {
      startOutcome = "failed";
      failureCodes.push("acceptance_compose_start_failed");
    }

    if (startOutcome === "passed") {
      const readinessCheck = manifest.baseline.find((check) => check.id === "readiness");
      if (!readinessCheck) throw new Error("acceptance_manifest_readiness_missing");
      readiness = await waitForReadiness(readinessCheck, {
        baseUrl,
        requestJson,
        sleep,
        now,
        startupTimeoutMs,
        probeIntervalMs,
      });

      for (const check of manifest.baseline) {
        if (check.id === "readiness" && readiness.outcome === "passed") {
          checks.push(readiness);
        } else {
          checks.push(await executeProbe(check, { baseUrl, requestJson, now }));
        }
      }
      if (checks.some((check) => check.outcome !== "passed")) {
        failureCodes.push("acceptance_baseline_failed");
      }
    }
  } finally {
    const down = composeDownCommand(manifest);
    try {
      await runCommand(down[0], down.slice(1), {
        environment: manifest.compose.environment,
      });
      cleanupOutcome = "passed";
    } catch {
      cleanupOutcome = "failed";
      failureCodes.push("acceptance_cleanup_failed");
    }
  }

  const allChecksPassed = checks.length === manifest.baseline.length
    && checks.every((check) => check.outcome === "passed");
  const outcome = startOutcome === "passed" && allChecksPassed && cleanupOutcome === "passed"
    ? "passed"
    : "failed";

  const report = Object.freeze({
    schemaVersion: 1,
    mode: manifest.mode,
    outcome,
    source: Object.freeze({ commitSha: validated.commitSha }),
    image: Object.freeze({ digest: validated.image.digest }),
    compose: Object.freeze({
      projectName: validated.projectName,
      start: startOutcome,
      cleanup: cleanupOutcome,
    }),
    failureCodes: Object.freeze([...new Set(failureCodes)]),
    checks: Object.freeze(checks),
    startedAt: isoTimestamp(startedAt),
    finishedAt: isoTimestamp(now()),
  });

  assertProductionAcceptanceReportSafe(report, { secretValues });
  return report;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderProductionAcceptanceHtml(report) {
  assertProductionAcceptanceReportSafe(report);
  const rows = report.checks.map((check) => (
    `<tr><td>${escapeHtml(check.id)}</td><td>${escapeHtml(check.outcome)}</td><td>${escapeHtml(check.status ?? "-")}</td><td>${escapeHtml(check.code)}</td><td>${escapeHtml(check.attempts)}</td></tr>`
  )).join("");

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Production acceptance</title></head><body>',
    "<h1>Production acceptance</h1>",
    `<p>Outcome: <strong>${escapeHtml(report.outcome)}</strong></p>`,
    `<p>Commit: <code>${escapeHtml(report.source.commitSha)}</code></p>`,
    `<p>Image digest: <code>${escapeHtml(report.image.digest)}</code></p>`,
    `<p>Compose project: <code>${escapeHtml(report.compose.projectName)}</code></p>`,
    `<p>Start: ${escapeHtml(report.compose.start)}; cleanup: ${escapeHtml(report.compose.cleanup)}</p>`,
    "<table><thead><tr><th>Check</th><th>Outcome</th><th>Status</th><th>Code</th><th>Attempts</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
    "</body></html>",
    "",
  ].join("\n");
}
