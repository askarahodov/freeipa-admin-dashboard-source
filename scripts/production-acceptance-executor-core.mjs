import {
  PRODUCTION_ACCEPTANCE_MANIFEST_VERSION,
  PRODUCTION_ACCEPTANCE_MODE,
  acceptanceProjectName,
  assertProductionAcceptanceReportSafe,
  createProductionAcceptanceManifest,
} from "./production-acceptance-contract.mjs";

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_PROBE_INTERVAL_MS = 1_000;
const ACCEPTANCE_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function normalizeProductionAcceptanceTarget(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("acceptance_base_url_invalid");
  }

  if (parsed.protocol !== "http:") throw new Error("acceptance_base_url_protocol_invalid");
  if (parsed.username || parsed.password) throw new Error("acceptance_base_url_credentials_forbidden");
  if (parsed.search) throw new Error("acceptance_base_url_query_forbidden");
  if (parsed.hash) throw new Error("acceptance_base_url_fragment_forbidden");
  if (parsed.pathname !== "/") throw new Error("acceptance_base_url_path_invalid");
  if (!ACCEPTANCE_LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("acceptance_base_url_loopback_required");
  }

  const port = parsed.port || "3001";
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("acceptance_base_url_port_invalid");
  }

  return Object.freeze({
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    composeEnvironment: Object.freeze({
      DASHBOARD_BIND_ADDRESS: "127.0.0.1",
      DASHBOARD_PORT: port,
    }),
  });
}

export function productionAcceptanceCommandEnvironment(
  ambientEnvironment,
  manifestEnvironment,
  target,
) {
  if (!target?.composeEnvironment) throw new Error("acceptance_base_url_invalid");
  return Object.freeze({
    ...(ambientEnvironment ?? {}),
    ...(manifestEnvironment ?? {}),
    ...target.composeEnvironment,
  });
}

export const PRODUCTION_ACCEPTANCE_REPORT_SCHEMA_VERSION = 1;

const REMEDIATION_BY_FAILURE_CODE = Object.freeze({
  acceptance_compose_start_failed: "inspect_local_compose_start",
  acceptance_baseline_timeout: "inspect_local_health_and_dependencies",
  acceptance_baseline_execution_failed: "inspect_acceptance_runtime",
  acceptance_schema_metadata_missing: "inspect_local_schema_readiness",
  acceptance_schema_version_mismatch: "inspect_local_schema_migrations",
  acceptance_cleanup_failed: "remove_isolated_acceptance_project",
  acceptance_local_auth_rbac_failed: "inspect_local_auth_acceptance",
  acceptance_p0_operational_failed: "inspect_p0_operational_acceptance",
  acceptance_settings_persistence_rollback_failed: "inspect_settings_acceptance",
  acceptance_freeipa_read_failed: "inspect_freeipa_acceptance",
  acceptance_freeipa_mutation_failed: "inspect_freeipa_acceptance",
  acceptance_freeipa_read_failed: "inspect_freeipa_read",
  acceptance_freeipa_crud_membership_failed: "inspect_freeipa_acceptance",
  acceptance_destructive_scenario_failed: "inspect_acceptance_scenarios",
});

export function productionAcceptanceRemediationCode(failureCode) {
  if (!failureCode) return "none";
  return REMEDIATION_BY_FAILURE_CODE[failureCode] ?? "inspect_acceptance_executor";
}

function acceptanceStage(id, outcome, code, remediationCode = "none") {
  return Object.freeze({ id, outcome, code, remediationCode });
}

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

function readinessSchemaMetadata(response) {
  const metadata = response?.json?.metadata;
  const currentVersion = Number(metadata?.schemaVersion);
  const latestVersion = Number(metadata?.latestSchemaVersion);
  if (
    !Number.isInteger(currentVersion)
    || currentVersion < 0
    || !Number.isInteger(latestVersion)
    || latestVersion < 0
  ) {
    return null;
  }
  return Object.freeze({ currentVersion, latestVersion });
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
  runPostBaseline = null,
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
  if (runPostBaseline !== null && typeof runPostBaseline !== "function") {
    throw new Error("acceptance_scenario_runner_invalid");
  }

  const started = now();
  const deadline = started.getTime() + startupTimeoutMs;
  let outcome = "failed";
  let failureCode = "acceptance_execution_failed";
  let checks = validated.baseline.map((check) => ({
    id: check.id,
    outcome: "skipped",
    code: "not_executed",
    status: 0,
  }));
  let composeStartStage = acceptanceStage("compose_start", "pending", "not_started");
  let baselineStage = acceptanceStage("baseline", "pending", "not_started");
  let cleanup = Object.freeze({ outcome: "pending", code: "cleanup_pending" });
  let cleanupStage = acceptanceStage("cleanup", "pending", "not_started");
  let portalSchema = null;
  let scenarioStages = [];

  try {
    await runCommand(validated.compose.args, validated.compose.environment);
    composeStartStage = acceptanceStage("compose_start", "passed", "compose_started");

    for (;;) {
      const currentChecks = [];
      for (const check of validated.baseline) {
        try {
          const response = await probe(check);
          const evaluated = evaluateAcceptanceCheck(check, response);
          currentChecks.push(evaluated);
          if (check.id === "readiness" && evaluated.outcome === "passed") {
            portalSchema = readinessSchemaMetadata(response);
          }
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
        if (!portalSchema) {
          outcome = "failed";
          failureCode = "acceptance_schema_metadata_missing";
          baselineStage = acceptanceStage(
            "baseline",
            "failed",
            failureCode,
            productionAcceptanceRemediationCode(failureCode),
          );
          break;
        }
        if (portalSchema.currentVersion !== portalSchema.latestVersion) {
          outcome = "failed";
          failureCode = "acceptance_schema_version_mismatch";
          baselineStage = acceptanceStage(
            "baseline",
            "failed",
            failureCode,
            productionAcceptanceRemediationCode(failureCode),
          );
          break;
        }
        outcome = "passed";
        failureCode = null;
        baselineStage = acceptanceStage("baseline", "passed", "baseline_healthy");
        break;
      }
      if (now().getTime() >= deadline) {
        failureCode = "acceptance_baseline_timeout";
        baselineStage = acceptanceStage(
          "baseline",
          "failed",
          failureCode,
          productionAcceptanceRemediationCode(failureCode),
        );
        break;
      }
      await sleep(probeIntervalMs);
    }

    if (outcome === "passed" && runPostBaseline) {
      try {
        const returnedStages = await runPostBaseline();
        if (!Array.isArray(returnedStages)) throw new Error("acceptance_scenario_result_invalid");
        scenarioStages = returnedStages;
      } catch (error) {
        scenarioStages = Array.isArray(error?.acceptanceStages) ? [...error.acceptanceStages] : [];
        failureCode = errorCode(error, "acceptance_destructive_scenario_failed");
        outcome = "failed";
      }
    }
  } catch (error) {
    if (composeStartStage.outcome === "pending") {
      failureCode = errorCode(error, "acceptance_compose_start_failed");
      composeStartStage = acceptanceStage(
        "compose_start",
        "failed",
        failureCode,
        productionAcceptanceRemediationCode(failureCode),
      );
      baselineStage = acceptanceStage(
        "baseline",
        "skipped",
        "blocked_by_compose_start",
        "inspect_local_compose_start",
      );
    } else {
      failureCode = errorCode(error, "acceptance_baseline_execution_failed");
      baselineStage = acceptanceStage(
        "baseline",
        "failed",
        failureCode,
        productionAcceptanceRemediationCode(failureCode),
      );
    }
  } finally {
    try {
      await runCommand(acceptanceCleanupCommand(validated), validated.compose.environment);
      cleanup = Object.freeze({ outcome: "passed", code: "cleanup_complete" });
      cleanupStage = acceptanceStage("cleanup", "passed", "cleanup_complete");
    } catch {
      cleanup = Object.freeze({ outcome: "failed", code: "cleanup_failed" });
      cleanupStage = acceptanceStage(
        "cleanup",
        "failed",
        "acceptance_cleanup_failed",
        productionAcceptanceRemediationCode("acceptance_cleanup_failed"),
      );
      outcome = "failed";
      if (!failureCode) failureCode = "acceptance_cleanup_failed";
    }
  }

  const finished = now();
  const report = {
    schemaVersion: PRODUCTION_ACCEPTANCE_REPORT_SCHEMA_VERSION,
    manifestSchemaVersion: validated.schemaVersion,
    portalSchema,
    outcome,
    failureCode,
    remediationCode: productionAcceptanceRemediationCode(failureCode),
    source: { commitSha: validated.source.commitSha },
    image: { digest: validated.image.digest },
    compose: { projectName: validated.compose.projectName },
    timing: {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
    },
    stages: [composeStartStage, baselineStage, ...scenarioStages, cleanupStage],
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
  const stageRows = report.stages
    .map((stage) => `<tr><td>${escapeHtml(stage.id)}</td><td>${escapeHtml(stage.outcome)}</td><td>${escapeHtml(stage.code)}</td><td>${escapeHtml(stage.remediationCode)}</td></tr>`)
    .join("");
  const rows = report.checks
    .map((check) => `<tr><td>${escapeHtml(check.id)}</td><td>${escapeHtml(check.outcome)}</td><td>${escapeHtml(check.code)}</td><td>${escapeHtml(check.status)}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Production acceptance</title></head>
<body>
<h1>Production acceptance: ${escapeHtml(report.outcome)}</h1>
<dl>
<dt>Report schema version</dt><dd>${escapeHtml(report.schemaVersion)}</dd>
<dt>Manifest schema version</dt><dd>${escapeHtml(report.manifestSchemaVersion)}</dd>
<dt>Portal schema version</dt><dd>${escapeHtml(report.portalSchema?.currentVersion ?? "unavailable")} / ${escapeHtml(report.portalSchema?.latestVersion ?? "unavailable")}</dd>
<dt>Commit</dt><dd>${escapeHtml(report.source.commitSha)}</dd>
<dt>Image digest</dt><dd>${escapeHtml(report.image.digest)}</dd>
<dt>Compose project</dt><dd>${escapeHtml(report.compose.projectName)}</dd>
<dt>Started</dt><dd>${escapeHtml(report.timing.startedAt)}</dd>
<dt>Finished</dt><dd>${escapeHtml(report.timing.finishedAt)}</dd>
<dt>Failure code</dt><dd>${escapeHtml(report.failureCode ?? "none")}</dd>
<dt>Remediation code</dt><dd>${escapeHtml(report.remediationCode)}</dd>
<dt>Cleanup</dt><dd>${escapeHtml(report.cleanup.outcome)} (${escapeHtml(report.cleanup.code)})</dd>
</dl>
<table>
<thead><tr><th>Stage</th><th>Outcome</th><th>Code</th><th>Remediation</th></tr></thead>
<tbody>${stageRows}</tbody>
</table>
<table>
<thead><tr><th>Check</th><th>Outcome</th><th>Code</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>
`;
}
