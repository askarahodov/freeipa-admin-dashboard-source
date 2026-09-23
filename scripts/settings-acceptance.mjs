#!/usr/bin/env node
import { executeSettingsPersistenceRollback } from "./settings-acceptance-core.mjs";
import { normalizeProductionAcceptanceTarget } from "./production-acceptance-executor-core.mjs";

const confirmation = String(process.env.PORTAL_TEST_CONFIRM ?? "").trim();
const adminUsername = String(process.env.PORTAL_TEST_ADMIN_USERNAME ?? "").trim();
const adminPassword = String(process.env.PORTAL_TEST_ADMIN_PASSWORD ?? "");
const rawBaseUrl = String(process.env.PORTAL_TEST_BASE_URL ?? "http://127.0.0.1:3001").trim();

if (confirmation !== "YES") {
  console.error("acceptance_settings_confirmation_required");
  process.exit(2);
}
if (!adminUsername || !adminPassword) {
  console.error("acceptance_settings_admin_credentials_required");
  process.exit(2);
}

let target;
try {
  target = normalizeProductionAcceptanceTarget(rawBaseUrl);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/^acceptance_base_url_/u.test(message) ? message : "acceptance_settings_target_invalid");
  process.exit(2);
}

let cookie = "";

async function request(pathname, { method = "GET", body } = {}) {
  const headers = { accept: "application/json" };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(new URL(pathname, target.baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

try {
  const login = await fetch(new URL("/api/auth/login", target.baseUrl), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const loginPayload = await login.json().catch(() => ({}));
  if (login.status !== 200 || loginPayload.authenticated !== true) {
    throw new Error("acceptance_settings_admin_login_failed");
  }
  cookie = String(login.headers.get("set-cookie") ?? "").split(";", 1)[0]?.trim() ?? "";
  if (!cookie.includes("=")) throw new Error("acceptance_settings_admin_login_failed");

  await executeSettingsPersistenceRollback({ request });
  console.log("SETTINGS_ACCEPTANCE_OUTCOME=passed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/^acceptance_[a-z0-9_]+$/u.test(message) ? message : "acceptance_settings_failed");
  process.exitCode = 1;
}
