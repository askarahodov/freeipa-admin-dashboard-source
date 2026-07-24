import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const confirmation = String(process.env.PORTAL_TEST_CONFIRM ?? "").trim();
const baseUrl = String(process.env.PORTAL_TEST_BASE_URL ?? "http://127.0.0.1:3001").trim().replace(/\/+$/, "");
const adminUsername = String(process.env.PORTAL_TEST_ADMIN_USERNAME ?? "").trim();
const adminPassword = String(process.env.PORTAL_TEST_ADMIN_PASSWORD ?? "");
const timeoutMs = Math.max(1_000, Math.min(Number(process.env.PORTAL_TEST_TIMEOUT_MS ?? 15_000) || 15_000, 120_000));

if (confirmation !== "YES") {
  console.error("Local auth acceptance mutates the portal user database. Set PORTAL_TEST_CONFIRM=YES.");
  process.exit(2);
}
if (!adminUsername || !adminPassword) {
  console.error("Set PORTAL_TEST_ADMIN_USERNAME and PORTAL_TEST_ADMIN_PASSWORD.");
  process.exit(2);
}
if (!/^https?:\/\//i.test(baseUrl)) {
  console.error("PORTAL_TEST_BASE_URL must be an http:// or https:// URL.");
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = path.resolve("artifacts/local-auth-acceptance");
const runDir = path.join(artifactRoot, runId);
const prefix = `portal-accept-${Date.now().toString(36)}`;
const secrets = new Set([adminPassword]);
const steps = [];
const createdUsers = [];
let adminCookie = "";
let fatalError = "";

function password() {
  const value = `Aa1-${randomBytes(18).toString("base64url")}`;
  secrets.add(value);
  return value;
}

function redact(value) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/(authorization|cookie|set-cookie|password|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 800);
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") ?? "";
  const cookie = value.split(";", 1)[0]?.trim() ?? "";
  if (!cookie.includes("=")) throw new Error("Login response did not set a session cookie");
  return cookie;
}

async function request(pathname, { method = "GET", cookie = "", body, expected } = {}) {
  const headers = { accept: "application/json" };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  const allowed = Array.isArray(expected) ? expected : expected === undefined ? null : [expected];
  if (allowed && !allowed.includes(response.status)) {
    throw new Error(`${method} ${pathname} returned HTTP ${response.status}: ${redact(payload.error ?? "unexpected response")}`);
  }
  return { response, payload };
}

async function step(name, action) {
  const started = Date.now();
  try {
    const detail = await action();
    steps.push({ name, status: "success", durationMs: Date.now() - started, detail: redact(detail ?? "ok") });
    return detail;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : error);
    steps.push({ name, status: "failed", durationMs: Date.now() - started, detail: message });
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(username, userPassword) {
  const { response, payload } = await request("/api/auth/login", {
    method: "POST",
    body: { username, password: userPassword },
    expected: 200,
  });
  assert(payload.authenticated === true, `Login was not authenticated for ${username}`);
  return cookieFrom(response);
}

async function createUser(username, role, userPassword) {
  const { payload } = await request("/api/auth/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username, displayName: `Acceptance ${role}`, password: userPassword, role },
    expected: 201,
  });
  assert(payload.user?.id, `User ID was not returned for ${username}`);
  const user = { id: String(payload.user.id), username, role };
  createdUsers.push(user);
  return user;
}

async function cleanup() {
  if (!adminCookie || !createdUsers.length) return;
  for (const user of [...createdUsers].reverse()) {
    try {
      await request(`/api/auth/users/${encodeURIComponent(user.id)}`, { method: "DELETE", cookie: adminCookie, expected: [200, 404] });
      steps.push({ name: `Cleanup ${user.username}`, status: "success", durationMs: 0, detail: "deleted" });
    } catch (error) {
      steps.push({ name: `Cleanup ${user.username}`, status: "failed", durationMs: 0, detail: redact(error instanceof Error ? error.message : error) });
    }
  }
}

function html(report) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const rows = report.steps.map((item) => `<tr><td>${escape(item.name)}</td><td class="${item.status}">${escape(item.status)}</td><td>${item.durationMs}</td><td>${escape(item.detail)}</td></tr>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Local auth acceptance</title><style>body{font-family:system-ui;margin:32px;color:#202536}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}.success{color:#17653a}.failed{color:#b42318}code{background:#f4f6fb;padding:2px 5px}</style></head><body><h1>Local auth acceptance</h1><p>Run: <code>${escape(report.runId)}</code></p><p>Status: <strong class="${report.status}">${escape(report.status)}</strong></p><p>Target: ${escape(report.target)}</p><table><thead><tr><th>Шаг</th><th>Статус</th><th>мс</th><th>Детали</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

async function writeReport() {
  const failed = steps.filter((item) => item.status === "failed").length;
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    target: new URL(baseUrl).origin,
    status: failed || fatalError ? "failed" : "success",
    summary: { total: steps.length, success: steps.length - failed, failed },
    error: redact(fatalError),
    steps,
  };
  await fs.mkdir(runDir, { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    fs.writeFile(path.join(runDir, "report.json"), serialized),
    fs.writeFile(path.join(runDir, "report.html"), html(report)),
    fs.mkdir(artifactRoot, { recursive: true }).then(() => fs.writeFile(path.join(artifactRoot, "latest.json"), serialized)),
  ]);
  console.log(`Local auth acceptance: ${report.status}`);
  console.log(path.relative(process.cwd(), path.join(runDir, "report.html")));
  return report;
}

try {
  await step("Portal health", async () => {
    await request("/api/integrations/health", { expected: 200 });
    return "HTTP 200";
  });

  adminCookie = await step("Bootstrap admin login", async () => login(adminUsername, adminPassword));

  await step("Admin session", async () => {
    const { payload } = await request("/api/auth/session", { cookie: adminCookie, expected: 200 });
    assert(payload.authenticated === true && payload.user?.role === "admin", "Bootstrap account is not an authenticated admin");
    return `${payload.user.username} · admin`;
  });

  const viewerPassword = password();
  const operatorPassword = password();
  const secondaryAdminPassword = password();
  const replacementViewerPassword = password();

  const viewer = await step("Create viewer", () => createUser(`${prefix}-viewer`, "viewer", viewerPassword));
  const operator = await step("Create operator", () => createUser(`${prefix}-operator`, "operator", operatorPassword));
  const secondaryAdmin = await step("Create second admin", () => createUser(`${prefix}-admin`, "admin", secondaryAdminPassword));

  const viewerCookie = await step("Viewer login", () => login(viewer.username, viewerPassword));
  const operatorCookie = await step("Operator login", () => login(operator.username, operatorPassword));
  const secondaryAdminCookie = await step("Second admin login", () => login(secondaryAdmin.username, secondaryAdminPassword));

  await step("Viewer is denied RBAC management", async () => {
    await request("/api/auth/users", { cookie: viewerCookie, expected: 403 });
    await request("/api/auth/diagnostics", { cookie: viewerCookie, expected: 403 });
    await request("/api/auth/sessions", { cookie: viewerCookie, expected: 403 });
    return "users, diagnostics and sessions returned HTTP 403";
  });

  await step("Operator is denied RBAC management", async () => {
    await request("/api/auth/users", { cookie: operatorCookie, expected: 403 });
    await request("/api/auth/diagnostics", { cookie: operatorCookie, expected: 403 });
    await request("/api/auth/sessions", { cookie: operatorCookie, expected: 403 });
    return "users, diagnostics and sessions returned HTTP 403";
  });

  await step("Second admin can read RBAC and diagnostics", async () => {
    await request("/api/auth/users", { cookie: secondaryAdminCookie, expected: 200 });
    await request("/api/auth/diagnostics", { cookie: secondaryAdminCookie, expected: 200 });
    await request("/api/auth/sessions", { cookie: secondaryAdminCookie, expected: 200 });
    return "admin endpoints returned HTTP 200";
  });

  await step("Authenticated roles can read portal status", async () => {
    for (const cookie of [viewerCookie, operatorCookie, secondaryAdminCookie]) {
      await request("/api/integrations/status", { cookie, expected: 200 });
    }
    return "viewer, operator and admin returned HTTP 200";
  });

  await step("Admin cannot demote own active account", async () => {
    const { payload } = await request("/api/auth/session", { cookie: adminCookie, expected: 200 });
    await request(`/api/auth/users/${encodeURIComponent(payload.user.id)}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { role: "viewer" },
      expected: 400,
    });
    return "HTTP 400";
  });

  await step("Password reset revokes viewer session", async () => {
    await request(`/api/auth/users/${encodeURIComponent(viewer.id)}/password`, {
      method: "POST",
      cookie: adminCookie,
      body: { password: replacementViewerPassword },
      expected: 200,
    });
    await request("/api/auth/session", { cookie: viewerCookie, expected: 401 });
    return "old cookie returned HTTP 401";
  });

  const replacementViewerCookie = await step("Viewer login with replacement password", () => login(viewer.username, replacementViewerPassword));

  await step("Revoke one selected viewer session", async () => {
    const { payload } = await request("/api/auth/sessions?limit=500", { cookie: adminCookie, expected: 200 });
    const selected = Array.isArray(payload.sessions) ? payload.sessions.find((item) => item.userId === viewer.id && item.current !== true) : null;
    assert(selected?.id, "Viewer session was not found in admin session list");
    await request(`/api/auth/sessions/${encodeURIComponent(selected.id)}`, { method: "DELETE", cookie: adminCookie, expected: 200 });
    await request("/api/auth/session", { cookie: replacementViewerCookie, expected: 401 });
    return "selected session revoked and cookie returned HTTP 401";
  });
} catch (error) {
  fatalError = error instanceof Error ? error.message : String(error);
} finally {
  await cleanup();
}

const report = await writeReport();
process.exit(report.status === "success" ? 0 : 1);