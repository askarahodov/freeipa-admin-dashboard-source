#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { executeBackupRestoreAcceptance } from "./backup-restore-acceptance-core.mjs";
import { normalizeProductionAcceptanceTarget } from "./production-acceptance-executor-core.mjs";

const confirm = String(process.env.PORTAL_TEST_CONFIRM ?? "").trim();
const adminUser = String(process.env.PORTAL_TEST_ADMIN_USERNAME ?? "").trim();
const adminCredential = String(process.env.PORTAL_TEST_ADMIN_PASSWORD ?? "");
const rawTarget = String(process.env.PORTAL_TEST_BASE_URL ?? "http://127.0.0.1:3001").trim();

if (confirm !== "YES") throw new Error("acceptance_backup_confirmation_required");
if (!adminUser || !adminCredential) throw new Error("acceptance_backup_admin_credentials_required");

const target = normalizeProductionAcceptanceTarget(rawTarget);
const origin = new URL(target.baseUrl).origin;
let cookie = "";

function requestHeaders(json = false) {
  const value = { accept: "application/json", origin };
  if (cookie) value.cookie = cookie;
  if (json) value["content-type"] = "application/json";
  return value;
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(new URL(pathname, target.baseUrl), {
    method,
    headers: requestHeaders(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

try {
  const login = await fetch(new URL("/api/auth/login", target.baseUrl), {
    method: "POST",
    headers: requestHeaders(true),
    body: JSON.stringify({ username: adminUser, password: adminCredential }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await login.json().catch(() => ({}));
  if (login.status !== 200 || payload.authenticated !== true) {
    throw new Error("acceptance_backup_admin_login_failed");
  }
  cookie = String(login.headers.get("set-cookie") ?? "").split(";", 1)[0]?.trim() ?? "";
  if (!cookie.includes("=")) throw new Error("acceptance_backup_admin_login_failed");

  await executeBackupRestoreAcceptance({
    request,
    password: `portal-acceptance-${randomBytes(32).toString("base64url")}`,
  });
  console.log("BACKUP_RESTORE_ACCEPTANCE_OUTCOME=passed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/^acceptance_[a-z0-9_]+$/u.test(message) ? message : "acceptance_backup_restore_failed");
  process.exitCode = 1;
}
