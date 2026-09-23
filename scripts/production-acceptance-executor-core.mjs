import {
  PRODUCTION_ACCEPTANCE_MANIFEST_VERSION,
  PRODUCTION_ACCEPTANCE_MODE,
  acceptanceProjectName,
  assertProductionAcceptanceReportSafe,
  createProductionAcceptanceManifest,
} from "./production-acceptance-contract.mjs";

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_PROBE_INTERVAL_MS = 1_000;

function errorCode(error, fallback) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /^acceptance_[a-z0-9_]+$/u.test(message) ? message : fallback;
}

function deepEqualRequired(actual, required) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(required).every(([key, expected]) => Object.is(actual[key], expected));
}

export function validateProductionAcceptanceManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("acceptance_manifest_invalid");
  }
  if (manifest.schemaVersion !== PRODUCTION_ACCEPTANCE_MANIFEST_VERSION) {
    throw new Error("acceptance_manifest_version_unsupported");
  }
  if (manifest.mode !== PRODUCTION_ACCEPTANCE_MODE || manifest.destructive !== false) {
    throw new Error("acceptance_manifest_mode_invalid");
  }

  const expected = createProductionAcceptanceManifest({
    imageReference: manifest.image?.reference,
    commitSha: manifest.source?.commitSha,
  });

  if (manifest.compose?.projectName !== acceptanceProjectName(expected.image.digest)) {
    throw new Error("acceptance_manifest_project_invalid");
  }
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error("acceptance_manifest_mismatch");
  }
  return expected;
}

export function evaluateAcceptanceCheck(check, response) {
  const status = Number(response?.status);
  const statusPassed = check.expectedStatus.includes(status);
  const jsonPassed = deepEqualRequired(response?.json, check.requiredJson);
  return Object.freeze({
    id: check.id,
    outcome: statusPassed && jsonPassed ? "passed" : "failed",
    code: statusPassed ? (jsonPassed ? "predicate_match" : "predicate_mismatch") : "status_mismatch",
    status,
  });
}

export function acceptanceCleanupCommand(manifest) {
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

export async function executeProductionAcceptance({
  manifest,
  runCommand,
  probe,
  now = () => new Date(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  secretValues = [],
} = {}) {
  const validated = validateProductionAcceptanceManifest(manifest);
  if (typeof runCommand !== "function" || typeof probe !== "function") {
    throw new Error("acceptance_executor_dependency_invalid");
  }
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) {
    throw new Error("acceptance_startup_timeout_invalid");
  }
  if (!Number.isFinite(probeIntervalMs) || probeIntervalMs < 0) {
    throw new Error("acceptance_probe_interval_invalid");
  }

  const started = now();
  const deadline = started.getTime() + startupTimeoutMs;
  let outcome = "failed";
  let failureCode = "acceptance_execution_failed";
  let checks = validated.baseline.map((check) => ({
    id: check.id,
    outcome: "failed",
    code: "not_executed",
    status: 0,
  }));
  let cleanup = Object.freeze({ outcome: "pending", code: "cleanup_pending" });

  try {
    await runCommand(validated.compose.args, validated.compose.environment);

    for (;;) {
      const currentChecks = [];
      for (const check of validated.baseline) {
        try {
          const response = await probe(check);
          currentChecks.push(evaluateAcceptanceCheck(check, response));
        } catch {
          currentChecks.push(Object.freeze({
            id: check.id,
            outcome: "failed",
            code: "probe_error",
            status: 0,
          }));
        }
      }
      checks = currentChecks;
      if (checks.every((check) => check.outcome === "passed")) {
        outcome = "passed";
        failureCode = null;
        break;
      }
      if (now().getTime() >= deadline) {
        failureCode = "acceptance_baseline_timeout";
        break;
      }
      await sleep(probeIntervalMs);
    }
  } catch (error) {
    failureCode = errorCode(error, "acceptance_compose_start_failed");
  } finally {
    try {
      await runCommand(acceptanceCleanupCommand(validated), validated.compose.environment);
      cleanup = Object.freeze({ outcome: "passed", code: "cleanup_complete" });
    } catch {
      cleanup = Object.freeze({ outcome: "failed", code: "cleanup_failed" });
      outcome = "failed";
      if (!failureCode) failureCode = "acceptance_cleanup_failed";
    }
  }

  const finished = now();
  const report = {
    schemaVersion: 1,
    outcome,
    failureCode,
    source: { commitSha: validated.source.commitSha },
    image: { digest: validated.image.digest },
    compose: { projectName: validated.compose.projectName },
    timing: {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
    },
    checks,
    cleanup,
  };

  assertProductionAcceptanceReportSafe(report, { secretValues });
  return Object.freeze(report);
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
  const rows = report.checks
    .map((check) => `<tr><td>${escapeHtml(check.id)}</td><td>${escapeHtml(check.outcome)}</td><td>${escapeHtml(check.code)}</td><td>${escapeHtml(check.status)}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Production acceptance</title></head>
<body>
<h1>Production acceptance: ${escapeHtml(report.outcome)}</h1>
<dl>
<dt>Commit</dt><dd>${escapeHtml(report.source.commitSha)}</dd>
<dt>Image digest</dt><dd>${escapeHtml(report.image.digest)}</dd>
<dt>Compose project</dt><dd>${escapeHtml(report.compose.projectName)}</dd>
<dt>Started</dt><dd>${escapeHtml(report.timing.startedAt)}</dd>
<dt>Finished</dt><dd>${escapeHtml(report.timing.finishedAt)}</dd>
<dt>Cleanup</dt><dd>${escapeHtml(report.cleanup.outcome)} (${escapeHtml(report.cleanup.code)})</dd>
</dl>
<table>
<thead><tr><th>Check</th><th>Outcome</th><th>Code</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>
`;
}
