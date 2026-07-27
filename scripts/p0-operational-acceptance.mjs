import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const confirmation = String(process.env.PORTAL_TEST_CONFIRM ?? "").trim();
const baseUrl = String(process.env.PORTAL_TEST_BASE_URL ?? "http://127.0.0.1:3001").trim().replace(/\/+$/, "");
const adminUsername = String(process.env.PORTAL_TEST_ADMIN_USERNAME ?? "").trim();
const adminPassword = String(process.env.PORTAL_TEST_ADMIN_PASSWORD ?? "");
const timeoutMs = clampNumber(process.env.PORTAL_TEST_TIMEOUT_MS, 15_000, 1_000, 120_000);
const restartEnabled = parseBoolean(process.env.PORTAL_TEST_RESTART_DASHBOARD, false);
const restartTimeoutMs = clampNumber(process.env.PORTAL_TEST_RESTART_TIMEOUT_MS, 120_000, 10_000, 600_000);
const composeFile = String(process.env.PORTAL_TEST_COMPOSE_FILE ?? "compose.yaml").trim();
const composeEnvFile = String(process.env.PORTAL_TEST_COMPOSE_ENV_FILE ?? ".env").trim();
const composeService = String(process.env.PORTAL_TEST_COMPOSE_SERVICE ?? "dashboard").trim();

if (confirmation !== "YES") {
  console.error("P0 acceptance mutates the portal user database. Set PORTAL_TEST_CONFIRM=YES.");
  process.exit(2);
}
if (!adminUsername || !adminPassword) {
  console.error("Set PORTAL_TEST_ADMIN_USERNAME and PORTAL_TEST_ADMIN_PASSWORD.");
  process.exit(2);
}

let targetOrigin = "";
try {
  const target = new URL(baseUrl);
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("unsupported protocol");
  if (target.username || target.password) throw new Error("credentials in URL are not allowed");
  targetOrigin = target.origin;
} catch {
  console.error("PORTAL_TEST_BASE_URL must be an http:// or https:// URL without embedded credentials.");
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = path.resolve("artifacts/p0-operational-acceptance");
const runDir = path.join(artifactRoot, runId);
const prefix = `portal-p0-${Date.now().toString(36)}`;
const userPassword = createPassword();
const wrongPassword = createPassword();
const secrets = new Set([adminPassword, userPassword, wrongPassword]);
const steps = [];
let adminCookie = "";
let createdUser = null;
let fatalError = "";

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  return Math.max(minimum, Math.min(Number.isFinite(parsed) ? parsed : fallback, maximum));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function createPassword() {
  return `Aa1-${randomBytes(18).toString("base64url")}`;
}

function redact(value) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/(authorization|cookie|set-cookie|password|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 1_200);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie") ?? "";
  assert(/(?:^|;\s*)HttpOnly(?:;|$)/i.test(header), "Login cookie is missing HttpOnly");
  assert(/(?:^|;\s*)SameSite=Strict(?:;|$)/i.test(header), "Login cookie is missing SameSite=Strict");
  const cookie = header.split(";", 1)[0]?.trim() ?? "";
  assert(cookie.includes("="), "Login response did not set a session cookie");
  secrets.add(cookie);
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

async function step(name, action, { skipped = false } = {}) {
  const started = Date.now();
  if (skipped) {
    const detail = typeof action === "string" ? action : "skipped";
    steps.push({ name, status: "skipped", durationMs: 0, detail: redact(detail) });
    console.log(`SKIP ${name}: ${redact(detail)}`);
    return undefined;
  }
  try {
    const result = await action();
    const detail = typeof result === "string" ? result : result === undefined ? "ok" : JSON.stringify(result);
    steps.push({ name, status: "success", durationMs: Date.now() - started, detail: redact(detail) });
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : error);
    steps.push({ name, status: "failed", durationMs: Date.now() - started, detail: message });
    console.error(`FAIL ${name}: ${message}`);
    throw error;
  }
}

async function login(username, password, expected = 200) {
  const { response, payload } = await request("/api/auth/login", {
    method: "POST",
    body: { username, password },
    expected,
  });
  if (expected !== 200) return { response, payload };
  assert(payload.authenticated === true, `Login was not authenticated for ${username}`);
  return { cookie: cookieFrom(response), payload };
}

async function createUser() {
  const username = `${prefix}-viewer`.slice(0, 63);
  const { payload } = await request("/api/auth/users", {
    method: "POST",
    cookie: adminCookie,
    body: { username, displayName: "P0 acceptance viewer", password: userPassword, role: "viewer" },
    expected: 201,
  });
  assert(payload.user?.id, "Created user response does not contain an ID");
  return { id: String(payload.user.id), username, role: "viewer" };
}

async function waitForPortal() {
  const deadline = Date.now() + restartTimeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await request("/api/integrations/health", { expected: 200 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(`Portal did not become healthy after restart: ${redact(lastError)}`);
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${redact(stderr || stdout)}`));
    });
  });
}

async function restartDashboard() {
  assert(composeFile && composeEnvFile && composeService, "Compose file, env file and service must be configured");
  await runCommand("docker", ["compose", "--env-file", composeEnvFile, "-f", composeFile, "restart", composeService]);
  await waitForPortal();
}

async function cleanup() {
  if (!createdUser) return;
  try {
    if (!adminCookie) adminCookie = (await login(adminUsername, adminPassword)).cookie;
    await request(`/api/auth/users/${encodeURIComponent(createdUser.id)}`, {
      method: "DELETE",
      cookie: adminCookie,
      expected: [200, 404],
    });
    steps.push({ name: `Cleanup ${createdUser.username}`, status: "success", durationMs: 0, detail: "deleted" });
  } catch (error) {
    steps.push({
      name: `Cleanup ${createdUser.username}`,
      status: "failed",
      durationMs: 0,
      detail: redact(error instanceof Error ? error.message : error),
    });
  }
}

function html(report) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const rows = report.steps.map((item) => `<tr><td>${escape(item.name)}</td><td class="${item.status}">${escape(item.status)}</td><td>${item.durationMs}</td><td>${escape(item.detail)}</td></tr>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>P0 operational acceptance</title><style>body{font-family:system-ui;margin:32px;color:#202536}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}.success{color:#17653a}.failed{color:#b42318}.skipped{color:#765}code{background:#f4f6fb;padding:2px 5px}</style></head><body><h1>P0 operational acceptance</h1><p>Run: <code>${escape(report.runId)}</code></p><p>Status: <strong class="${report.status}">${escape(report.status)}</strong></p><p>Target: ${escape(report.target)}</p><table><thead><tr><th>Шаг</th><th>Статус</th><th>мс</th><th>Детали</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

async function writeReport() {
  const failed = steps.filter((item) => item.status === "failed").length;
  const skipped = steps.filter((item) => item.status === "skipped").length;
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    target: targetOrigin,
    restartEnabled,
    status: failed || fatalError ? "failed" : "success",
    summary: { total: steps.length, success: steps.length - failed - skipped, failed, skipped },
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
  console.log(`P0 operational acceptance: ${report.status}`);
  console.log(path.relative(process.cwd(), path.join(runDir, "report.html")));
  return report;
}

try {
  await step("Portal health", async () => {
    await request("/api/integrations/health", { expected: 200 });
    return "HTTP 200";
  });

  adminCookie = await step("Bootstrap admin login and cookie policy", async () => {
    const authenticated = await login(adminUsername, adminPassword);
    return authenticated.cookie;
  });

  await step("Bootstrap account is admin", async () => {
    const { payload } = await request("/api/auth/session", { cookie: adminCookie, expected: 200 });
    assert(payload.authenticated === true && payload.user?.role === "admin", "Bootstrap account is not an authenticated admin");
    return `${payload.user.username} · admin`;
  });

  createdUser = await step("Create lockout and persistence test user", createUser);

  await step("Five wrong passwords trigger temporary lockout", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const { payload } = await login(createdUser.username, wrongPassword, 401);
      assert(payload.authenticated === false, `Wrong-password attempt ${attempt} unexpectedly authenticated`);
    }
    const { payload } = await login(createdUser.username, userPassword, 401);
    assert(payload.authenticated === false, "Correct password bypassed temporary lockout");
    const users = (await request("/api/auth/users", { cookie: adminCookie, expected: 200 })).payload.users ?? [];
    const locked = users.find((item) => String(item.id) === createdUser.id);
    assert(locked && Number(locked.lockedUntil ?? 0) > Date.now(), "User is not marked as temporarily locked");
    return { attempts: 5, lockedUntil: Number(locked.lockedUntil) };
  });

  await step("Admin unlocks user and correct password works", async () => {
    await request(`/api/auth/users/${encodeURIComponent(createdUser.id)}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { disabled: false },
      expected: 200,
    });
    await login(createdUser.username, userPassword);
    return "unlocked and authenticated";
  });

  if (restartEnabled) {
    await step("Restart dashboard container", async () => {
      await restartDashboard();
      return `${composeService} restarted`;
    });

    adminCookie = await step("Bootstrap admin survives restart", async () => {
      const authenticated = await login(adminUsername, adminPassword);
      return authenticated.cookie;
    });

    await step("Created user and role survive restart", async () => {
      const users = (await request("/api/auth/users", { cookie: adminCookie, expected: 200 })).payload.users ?? [];
      const persisted = users.find((item) => String(item.id) === createdUser.id);
      assert(persisted, "Created user disappeared after Docker restart");
      assert(persisted.username === createdUser.username, "Persisted username changed after restart");
      assert(persisted.role === createdUser.role, "Persisted role changed after restart");
      await login(createdUser.username, userPassword);
      return { username: persisted.username, role: persisted.role };
    });
  } else {
    await step("Docker restart persistence", "PORTAL_TEST_RESTART_DASHBOARD is disabled", { skipped: true });
  }
} catch (error) {
  fatalError = error instanceof Error ? error.message : String(error);
} finally {
  await cleanup();
}

const report = await writeReport();
process.exit(report.status === "success" ? 0 : 1);
