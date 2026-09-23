#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  executeProductionAcceptance,
  normalizeProductionAcceptanceTarget,
  productionAcceptanceCommandEnvironment,
  renderProductionAcceptanceHtml,
  validateProductionAcceptanceManifest,
} from "./production-acceptance-executor-core.mjs";

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
const rawBaseUrl = argument("--base-url") ?? process.env.PORTAL_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3001";

try {
  const acceptanceTarget = normalizeProductionAcceptanceTarget(rawBaseUrl);
  const startupTimeoutMs = positiveNumber(argument("--startup-timeout-ms"), 60_000);
  const probeIntervalMs = positiveNumber(argument("--probe-interval-ms"), 1_000);
  const manifest = JSON.parse(await fs.readFile(planPath, "utf8"));
  validateProductionAcceptanceManifest(manifest);

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

  const report = await executeProductionAcceptance({
    manifest,
    runCommand,
    probe,
    startupTimeoutMs,
    probeIntervalMs,
    secretValues: environmentSecretValues(),
  });
  const html = renderProductionAcceptanceHtml(report);

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outputDirectory, "report.html"), html);

  console.log(`ACCEPTANCE_OUTCOME=${report.outcome}`);
  console.log(`ACCEPTANCE_REPORT=${path.relative(process.cwd(), path.join(outputDirectory, "report.json"))}`);
  console.log(`ACCEPTANCE_HTML=${path.relative(process.cwd(), path.join(outputDirectory, "report.html"))}`);
  if (report.outcome !== "passed") process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/^acceptance_[a-z0-9_:.,\[\]$-]+$/u.test(message) ? message : "acceptance_executor_failed");
  process.exitCode = 2;
}
