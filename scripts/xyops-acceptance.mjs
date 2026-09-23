#!/usr/bin/env node
import {
  executeXyOpsLifecycleAcceptance,
  executeXyOpsReadAcceptance,
} from "./xyops-acceptance-core.mjs";
import { normalizeProductionAcceptanceTarget } from "./production-acceptance-executor-core.mjs";

const confirm = String(process.env.PORTAL_TEST_CONFIRM ?? "").trim();
const adminUser = String(process.env.PORTAL_TEST_ADMIN_USERNAME ?? "").trim();
const adminPassword = String(process.env.PORTAL_TEST_ADMIN_PASSWORD ?? "");
const requesterUser = String(process.env.PORTAL_ACCEPTANCE_XYOPS_REQUESTER_USERNAME ?? "").trim();
const requesterPassword = String(process.env.PORTAL_ACCEPTANCE_XYOPS_REQUESTER_PASSWORD ?? "");
const eventId = String(process.env.PORTAL_ACCEPTANCE_XYOPS_EVENT_ID ?? "").trim();
const confirmedEventId = String(process.env.PORTAL_ACCEPTANCE_XYOPS_CONFIRM_EVENT_ID ?? "").trim();
const rawTarget = String(process.env.PORTAL_TEST_BASE_URL ?? "http://127.0.0.1:3001").trim();
const mode = String(process.env.PORTAL_ACCEPTANCE_XYOPS_MODE ?? "read").trim();

if (confirm !== "YES") throw new Error("acceptance_xyops_confirmation_required");
if (!adminUser || !adminPassword) throw new Error("acceptance_xyops_admin_credentials_required");
if (!["read", "lifecycle"].includes(mode)) throw new Error("acceptance_xyops_mode_invalid");
if (mode === "lifecycle" && (!requesterUser || !requesterPassword)) {
  throw new Error("acceptance_xyops_requester_credentials_required");
}
if (mode === "lifecycle" && (!eventId || confirmedEventId !== eventId)) {
  throw new Error("acceptance_xyops_event_confirmation_required");
}

const target = normalizeProductionAcceptanceTarget(rawTarget);
const origin = new URL(target.baseUrl).origin;

async function loginClient(username, password) {
  const login = await fetch(new URL("/api/auth/login", target.baseUrl), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", origin },
    body: JSON.stringify({ username, password }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await login.json().catch(() => ({}));
  if (login.status !== 200 || payload.authenticated !== true) {
    throw new Error("acceptance_xyops_portal_login_failed");
  }
  const cookie = String(login.headers.get("set-cookie") ?? "").split(";", 1)[0]?.trim() ?? "";
  if (!cookie.includes("=")) throw new Error("acceptance_xyops_portal_login_failed");

  return async function request(pathname, { method = "GET", body } = {}) {
    const headers = { accept: "application/json", origin, cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(new URL(pathname, target.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    return {
      status: response.status,
      json: await response.json().catch(() => ({})),
    };
  };
}

try {
  const adminRequest = await loginClient(adminUser, adminPassword);
  if (mode === "read") {
    await executeXyOpsReadAcceptance({ request: adminRequest });
  } else {
    const requesterRequest = await loginClient(requesterUser, requesterPassword);
    await executeXyOpsLifecycleAcceptance({
      requesterRequest,
      approverRequest: adminRequest,
      eventId,
      confirmedEventId,
    });
  }
  console.log("XYOPS_ACCEPTANCE_OUTCOME=passed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(/^acceptance_[a-z0-9_]+$/u.test(message) ? message : "acceptance_xyops_failed");
  process.exitCode = 1;
}
