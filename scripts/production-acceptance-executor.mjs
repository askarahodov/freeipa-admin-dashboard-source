#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS,
  normalizeProductionAcceptanceRetentionSeconds,
  writeProductionAcceptanceArtifacts,
} from "./production-acceptance-artifacts.mjs";
import {
  executeProductionAcceptance,
  normalizeProductionAcceptanceTarget,
  productionAcceptanceCommandEnvironment,
  renderProductionAcceptanceHtml,
  validateProductionAcceptanceManifest,
} from "./production-acceptance-executor-core.mjs";
import {
  productionAcceptanceScenarioDefinitions,
  productionAcceptanceScenarioEnvironment,
  runProductionAcceptanceScenarios,
  validateProductionAcceptanceMutationConfirmation,
} from "./production-acceptance-scenarios.mjs";

const execFileAsync = promisify(execFile);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveNumber(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("acceptance_numeric_argument_invalid");
  return parsed;
}

function environmentSecretValues() {
  const sensitiveName = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|config[_-]?encryption[_-]?key)/iu;
  return Object.entries(process.env)
    .filter(([name, value]) => sensitiveName.test(name) && value)
    .map(([, value]) => String(value));
}

const planPath = path.resolve(argument("--plan") ?? "artifacts/production-acceptance/plan.json");
const outputDirectory = path.resolve(argument("--output-dir") ?? "artifacts/production-acceptance/latest");
const historyDirectory = path.resolve(argument("--history-dir") ?? "artifacts/production-acceptance/runs");
const rawBaseUrl = argument("--base-url") ?? process.env.PORTAL_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3001";
const runLocalAuthP0 = process.argv.includes("--run-local-auth-p0");
const runSettings = process.argv.includes("--run-settings");
const runFreeIpaRead = process.argv.includes("--run-freeipa-read");
const runFreeIpaMutations = process.argv.includes("--run-freeipa-mutations");

try {
  const acceptanceTarget = normalizeProductionAcceptanceTarget(rawBaseUrl);
  const retentionSeconds = normalizeProductionAcceptanceRetentionSeconds(
    argument("--retention-seconds"),
    DEFAULT_PRODUCTION_ACCEPTANCE_RETENTION_SECONDS,
  );
  const startupTimeoutMs = positiveNumber(argument("--startup-timeout-ms"), 60_000);
  const probeIntervalMs = positiveNumber(argument("--probe-interval-ms"), 1_000);
  const manifest = JSON.parse(await fs.readFile(planPath, "utf8"));
  validateProductionAcceptanceManifest(manifest);

  const mutationRequested = runLocalAuthP0 || runSettings || runFreeIpaMutations;
  validateProductionAcceptanceMutationConfirmation({
    enabled: mutationRequested,
    confirmation: argument("--confirm-destructive") ?? process.env.PORTAL_ACCEPTANCE_CONFIRM_DESTRUCTIVE,
    confirmedProject: argument("--confirm-project") ?? process.env.PORTAL_ACCEPTANCE_CONFIRM_PROJECT,
    expectedProject: manifest.compose.projectName,
  });

  const scenarioDefinitions = productionAcceptanceScenarioDefinitions({
    includeLocalAuthP0: runLocalAuthP0,
    includeSettings: runSettings,
    includeFreeIpaRead: runFreeIpaRead,
    includeFreeIpaMutations: runFreeIpaMutations,
  });
  const scenarioEnvironment = scenarioDefinitions.length
    ? productionAcceptanceScenarioEnvironment({
        ambientEnvironment: process.env,
        baseUrl: acceptanceTarget.baseUrl,
        adminUsername: process.env.PORTAL_ACCEPTANCE_ADMIN_USERNAME,
        adminPassword: process.env.PORTAL_ACCEPTANCE_ADMIN_PASSWORD,
        projectName: manifest.compose.projectName,
      })
    : null;

  const runCommand = async (command, environment) => {
    const [executable, ...args] = command;
    await execFileAsync(executable, args, {
      env: productionAcceptanceCommandEnvironment(
        process.env,
        environment,
        acceptanceTarget,
      ),
      maxBuffer: 1024 * 1024,
    });
  };

  const probe = async (check) => {
    const response = await fetch(new URL(check.path, acceptanceTarget.baseUrl), {
      method: check.method,
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  };

  const runPostBaseline = scenarioDefinitions.length
    ? async () => runProductionAcceptanceScenarios({
        environment: scenarioEnvironment,
        definitions: scenarioDefinitions,
        runScript: async (script, environment) => {
          await execFileAsync(process.execPath, [script], {
            env: environment,
            maxBuffer: 1024 * 1024,
          });
        },
      })
    : null;

  const report = await executeProductionAcceptance({
    manifest,
    runCommand,
    probe,
    startupTimeoutMs,
    probeIntervalMs,
    secretValues: environmentSecretValues(),
    runPostBaseline,
  });
  const html = renderProductionAcceptanceHtml(report);

  const artifacts = await writeProductionAcceptanceArtifacts({
    report,
    html,
    outputDirectory,
    historyDirectory,
    retentionSeconds,
  });

  console.log(`ACCEPTANCE_OUTCOME=${report.outcome}`);
  console.log(`ACCEPTANCE_REPORT=${path.relative(process.cwd(), path.join(outputDirectory, "report.json"))}`);
  console.log(`ACCEPTANCE_HTML=${path.relative(process.cwd(), path.join(outputDirectory, "report.html"))}`);
  console.log(`ACCEPTANCE_RUN=${artifacts.runId}`);
  if (report.outcome !== "passed") process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/^acceptance_[a-z0-9_:.,\[\]$-]+$/u.test(message) ? message : "acceptance_executor_failed");
  process.exitCode = 2;
}
