#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  executeUpgradeAcceptance,
} from "./upgrade-acceptance-core.mjs";
import {
  normalizeProductionAcceptanceTarget,
  productionAcceptanceCommandEnvironment,
} from "./production-acceptance-executor-core.mjs";

const execFileAsync = promisify(execFile);
const confirm = String(process.env.PORTAL_TEST_CONFIRM ?? "").trim();
const adminUsername = String(process.env.PORTAL_TEST_ADMIN_USERNAME ?? "").trim();
const adminPassword = String(process.env.PORTAL_TEST_ADMIN_PASSWORD ?? "");
const projectName = String(process.env.PORTAL_ACCEPTANCE_PROJECT_NAME ?? "").trim();
const targetImage = String(process.env.PORTAL_ACCEPTANCE_TARGET_IMAGE ?? "").trim();
const targetCommit = String(process.env.PORTAL_ACCEPTANCE_TARGET_COMMIT ?? "").trim();
const policyPath = fileURLToPath(new URL("../release/previous-supported.json", import.meta.url));
const rawBaseUrl = String(process.env.PORTAL_TEST_BASE_URL ?? "http://127.0.0.1:3001").trim();

if (confirm !== "YES") throw new Error("acceptance_upgrade_confirmation_required");
if (!adminUsername || !adminPassword) throw new Error("acceptance_upgrade_admin_credentials_required");
if (!projectName || !targetImage || !targetCommit) {
  throw new Error("acceptance_upgrade_configuration_required");
}

const target = normalizeProductionAcceptanceTarget(rawBaseUrl);
const origin = new URL(target.baseUrl).origin;
const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));

async function runCommand(command, environment = {}) {
  const [executable, ...args] = command;
  await execFileAsync(executable, args, {
    env: productionAcceptanceCommandEnvironment(process.env, {
      ...environment,
      PORTAL_SERVICE_ENV_FILE: ".env.acceptance",
    }, target),
    maxBuffer: 1024 * 1024,
  });
}

async function readSourceImageRevision(imageReference) {
  try {
    const { stdout } = await execFileAsync("docker", [
      "image",
      "inspect",
      imageReference,
      "--format",
      '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
    ], {
      maxBuffer: 64 * 1024,
    });
    return String(stdout ?? "").trim();
  } catch {
    throw new Error("acceptance_upgrade_source_provenance_unavailable");
  }
}

async function waitReady(expectedVersion) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const response = await fetch(new URL("/health/ready", target.baseUrl), {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      const json = await response.json().catch(() => ({}));
      const currentVersion = Number(json?.metadata?.schemaVersion);
      const latestVersion = Number(json?.metadata?.latestSchemaVersion);
      if (response.status === 200
          && json?.state === "healthy"
          && json?.ok === true
          && Number.isInteger(currentVersion)
          && Number.isInteger(latestVersion)
          && (expectedVersion === undefined || currentVersion === expectedVersion)) {
        return { currentVersion, latestVersion };
      }
    } catch {
      // bounded polling owns transient startup failures
    }
    if (Date.now() >= deadline) throw new Error("acceptance_upgrade_readiness_timeout");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function verifyTargetBaseline() {
  const checks = [
    ["/health/live", { state: "healthy", code: "health_live", ok: true }],
    ["/health/ready", { state: "healthy", code: "health_ready", ok: true }],
    ["/health/dependencies", { state: "healthy", code: "dependencies_healthy", ok: true }],
    ["/api/maintenance/status", { maintenance: false, state: "inactive", recoveryRequired: false }],
  ];
  for (const [pathname, expected] of checks) {
    const response = await fetch(new URL(pathname, target.baseUrl), {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    const json = await response.json().catch(() => ({}));
    if (response.status !== 200
        || Object.entries(expected).some(([key, value]) => json?.[key] !== value)) {
      throw new Error("acceptance_upgrade_target_baseline_failed");
    }
  }
}

function requestHeaders(cookie = "", json = false) {
  const headers = { accept: "application/json", origin };
  if (cookie) headers.cookie = cookie;
  if (json) headers["content-type"] = "application/json";
  return headers;
}

async function createAuthenticatedRequest() {
  const login = await fetch(new URL("/api/auth/login", target.baseUrl), {
    method: "POST",
    headers: requestHeaders("", true),
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await login.json().catch(() => ({}));
  if (login.status !== 200 || payload.authenticated !== true) {
    throw new Error("acceptance_upgrade_admin_login_failed");
  }
  const cookie = String(login.headers.get("set-cookie") ?? "").split(";", 1)[0]?.trim() ?? "";
  if (!cookie.includes("=")) throw new Error("acceptance_upgrade_admin_login_failed");

  return async (pathname, { method = "GET", body } = {}) => {
    const response = await fetch(new URL(pathname, target.baseUrl), {
      method,
      headers: requestHeaders(cookie, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, json: await response.json().catch(() => ({})) };
  };
}

try {
  await executeUpgradeAcceptance({
    policy,
    targetImageReference: targetImage,
    targetCommitSha: targetCommit,
    projectName,
    runCommand,
    waitReady,
    readSourceImageRevision,
    verifyTargetBaseline,
    createAuthenticatedRequest,
  });
  console.log("UPGRADE_ACCEPTANCE_OUTCOME=passed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/^acceptance_[a-z0-9_]+$/u.test(message) ? message : "acceptance_upgrade_failed");
  process.exitCode = 1;
}
