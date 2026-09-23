#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { assertProductionAcceptanceReportSafe } from "./production-acceptance-contract.mjs";
import {
  renderProductionAcceptanceHtml,
  runProductionAcceptance,
} from "./production-acceptance-executor.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveNumber(value, fallback, code) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function commandRunner(command, args, { environment = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...environment },
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", () => reject(new Error("acceptance_compose_command_failed")));
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error("acceptance_compose_command_failed"));
    });
  });
}

function createRequestJson(requestTimeoutMs) {
  return async (url, method) => {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { accept: "application/json" },
    });
    let json = null;
    let jsonValid = true;
    try {
      json = await response.json();
    } catch {
      jsonValid = false;
    }
    return { status: response.status, json, jsonValid };
  };
}

function knownSecretValues() {
  const keys = [
    "CONFIG_ENCRYPTION_KEY",
    "ADMIN_TOKEN",
    "IPA_PASSWORD",
    "XYOPS_API_KEY",
    "PORTAL_BOOTSTRAP_ADMIN_PASSWORD",
    "PORTAL_TEST_ADMIN_PASSWORD",
  ];
  const values = keys.map((key) => process.env[key]).filter(Boolean);
  const extra = process.env.PORTAL_ACCEPTANCE_SECRET_VALUES_JSON;
  if (extra) {
    let parsed;
    try {
      parsed = JSON.parse(extra);
    } catch {
      throw new Error("acceptance_secret_values_invalid");
    }
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
      throw new Error("acceptance_secret_values_invalid");
    }
    values.push(...parsed.filter(Boolean));
  }
  return values;
}

function safeErrorCode(error) {
  const message = error instanceof Error ? error.message : "";
  return /^acceptance_[a-z0-9_:-]+$/u.test(message)
    ? message
    : "acceptance_executor_failed";
}

const planPath = path.resolve(argument("--plan") ?? "artifacts/production-acceptance/plan.json");
const outputDirectory = path.resolve(argument("--output-dir") ?? "artifacts/production-acceptance/run");
const baseUrl = argument("--base-url")
  ?? process.env.PORTAL_ACCEPTANCE_BASE_URL
  ?? `http://127.0.0.1:${process.env.PORTAL_ACCEPTANCE_PORT ?? "3001"}`;

try {
  const startupTimeoutMs = positiveNumber(
    argument("--startup-timeout-ms") ?? process.env.PORTAL_ACCEPTANCE_STARTUP_TIMEOUT_MS,
    120_000,
    "acceptance_startup_timeout_invalid",
  );
  const probeIntervalMs = positiveNumber(
    argument("--probe-interval-ms") ?? process.env.PORTAL_ACCEPTANCE_PROBE_INTERVAL_MS,
    2_000,
    "acceptance_probe_interval_invalid",
  );
  const requestTimeoutMs = positiveNumber(
    argument("--request-timeout-ms") ?? process.env.PORTAL_ACCEPTANCE_REQUEST_TIMEOUT_MS,
    5_000,
    "acceptance_request_timeout_invalid",
  );

  const manifest = JSON.parse(await fs.readFile(planPath, "utf8"));
  await fs.access(path.resolve(manifest?.compose?.serviceEnvFile ?? ".env.acceptance"));

  const secretValues = knownSecretValues();
  const report = await runProductionAcceptance(manifest, {
    baseUrl,
    runCommand: commandRunner,
    requestJson: createRequestJson(requestTimeoutMs),
    startupTimeoutMs,
    probeIntervalMs,
    secretValues,
  });

  assertProductionAcceptanceReportSafe(report, { secretValues });
  const html = renderProductionAcceptanceHtml(report);

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outputDirectory, "report.html"), html);

  console.log(`ACCEPTANCE_OUTCOME=${report.outcome}`);
  console.log(`ACCEPTANCE_PROJECT=${report.compose.projectName}`);
  console.log(`ACCEPTANCE_REPORT=${path.relative(process.cwd(), path.join(outputDirectory, "report.json"))}`);
  console.log(`ACCEPTANCE_HTML=${path.relative(process.cwd(), path.join(outputDirectory, "report.html"))}`);
  if (report.outcome !== "passed") process.exitCode = 1;
} catch (error) {
  console.error(safeErrorCode(error));
  process.exitCode = 2;
}
