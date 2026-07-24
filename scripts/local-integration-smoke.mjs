import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SECRET_KEY = /password|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|session/i;
const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);

export function parseDotEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function parseJson(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return JSON.parse(String(value));
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => SECRET_KEY.test(key) ? [] : [[key, redact(item)]]));
}

export function createTestNames(prefix = "portal-test") {
  const safePrefix = String(prefix).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!safePrefix.startsWith("portal-test")) throw new Error("LOCAL_TEST_PREFIX must start with portal-test");
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const usernamePrefix = safePrefix.replace(/-/g, "").slice(0, 14) || "portaltest";
  return {
    username: `${usernamePrefix}${suffix}`.slice(0, 30),
    group: `${safePrefix}-${suffix}`.slice(0, 48),
  };
}

export function assertMutationAllowed(config, feature) {
  if (!parseBoolean(config.LOCAL_TEST_MUTATIONS)) throw new Error(`${feature}: LOCAL_TEST_MUTATIONS=true is required`);
  if (String(config.LOCAL_TEST_CONFIRM_MUTATIONS).trim() !== "YES") throw new Error(`${feature}: LOCAL_TEST_CONFIRM_MUTATIONS=YES is required`);
  if (!String(config.LOCAL_TEST_PREFIX || "").toLowerCase().startsWith("portal-test")) throw new Error(`${feature}: LOCAL_TEST_PREFIX must start with portal-test`);
}

function safeText(value, limit = 240) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").slice(0, limit);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function loadConfiguration() {
  const envFile = process.env.LOCAL_TEST_ENV_FILE || ".env.test";
  const fileValues = existsSync(envFile) ? parseDotEnv(await readFile(envFile, "utf8")) : {};
  return { ...fileValues, ...process.env, LOCAL_TEST_ENV_FILE: envFile };
}

async function requestJson(config, pathname, options = {}) {
  const baseUrl = String(config.LOCAL_TEST_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
  const timeoutMs = Math.max(1000, Number(config.LOCAL_TEST_REQUEST_TIMEOUT_MS || 20000));
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (config.ADMIN_TOKEN) headers.set("x-admin-token", String(config.ADMIN_TOKEN));
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body === undefined || typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text: safeText(text) }; }
  if (!response.ok) {
    const message = body?.error || body?.message || body?.text || `HTTP ${response.status}`;
    throw new Error(`${pathname}: HTTP ${response.status}: ${safeText(message)}`);
  }
  return { status: response.status, body };
}

function summarizeStatus(body) {
  return redact({
    mode: body?.mode,
    identity: body?.access?.identity,
    role: body?.access?.role,
    database: body?.database || body?.storage,
    freeipa: body?.freeipa,
    xyops: body?.xyops,
  });
}

function renderHtml(report) {
  const rows = report.steps.map((step) => `<tr><td>${escapeHtml(step.name)}</td><td>${escapeHtml(step.outcome)}</td><td>${step.durationMs}</td><td><pre>${escapeHtml(JSON.stringify(step.details ?? {}, null, 2))}</pre>${step.error ? `<p>${escapeHtml(step.error)}</p>` : ""}</td></tr>`).join("\n");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Local integration report</title><style>body{font-family:system-ui;margin:32px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;vertical-align:top}pre{white-space:pre-wrap;margin:0}.passed{color:green}.failed{color:#b00020}.skipped{color:#765}</style></head><body><h1>Local integration report</h1><p>Run: ${escapeHtml(report.runId)}</p><p>Result: <strong class="${escapeHtml(report.outcome)}">${escapeHtml(report.outcome)}</strong></p><table><thead><tr><th>Проверка</th><th>Результат</th><th>мс</th><th>Детали</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

async function main() {
  const config = await loadConfiguration();
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = path.resolve(config.LOCAL_TEST_ARTIFACT_DIR || "artifacts/local-integration");
  const runDirectory = path.join(artifactRoot, runId);
  await mkdir(runDirectory, { recursive: true });

  const report = {
    runId,
    startedAt: new Date().toISOString(),
    baseUrl: config.LOCAL_TEST_BASE_URL || "http://127.0.0.1:3001",
    environmentFile: config.LOCAL_TEST_ENV_FILE,
    mutationMode: parseBoolean(config.LOCAL_TEST_MUTATIONS),
    steps: [],
    outcome: "running",
  };

  const runStep = async (name, action, options = {}) => {
    const started = Date.now();
    try {
      const details = redact(await action());
      report.steps.push({ name, outcome: "passed", durationMs: Date.now() - started, details });
      console.log(`PASS ${name}`);
      return details;
    } catch (error) {
      const message = safeText(error instanceof Error ? error.message : error);
      report.steps.push({ name, outcome: options.skipped ? "skipped" : "failed", durationMs: Date.now() - started, error: message });
      console.error(`${options.skipped ? "SKIP" : "FAIL"} ${name}: ${message}`);
      if (options.fatal) throw error;
      return undefined;
    }
  };

  let catalogEvents = [];
  await runStep("Portal health", async () => ({ status: (await requestJson(config, "/api/integrations/health")).status }));
  await runStep("Portal status and local storage", async () => summarizeStatus((await requestJson(config, "/api/integrations/status")).body));
  await runStep("FreeIPA users read", async () => {
    const { body } = await requestJson(config, "/api/integrations/users");
    if (!Array.isArray(body.users)) throw new Error("users response does not contain an array");
    return { mode: body.mode, count: body.users.length };
  });
  await runStep("FreeIPA groups read", async () => {
    const { body } = await requestJson(config, "/api/integrations/groups");
    if (!Array.isArray(body.groups)) throw new Error("groups response does not contain an array");
    return { mode: body.mode, source: body.source, degraded: Boolean(body.degraded), count: body.groups.length };
  });
  await runStep("XYOps catalog read", async () => {
    const { body } = await requestJson(config, "/api/integrations/catalog");
    if (!Array.isArray(body.events)) throw new Error("catalog response does not contain an events array");
    catalogEvents = body.events;
    return { mode: body.mode, count: body.events.length, processes: body.events.slice(0, 20).map((item) => ({ id: item.id, kind: item.kind, title: item.title })) };
  });
  await runStep("Operation history read", async () => {
    const { body } = await requestJson(config, "/api/integrations/runs?sync=1");
    if (!Array.isArray(body.runs)) throw new Error("runs response does not contain an array");
    return { count: body.runs.length, stats: body.stats };
  });

  if (config.LOCAL_TEST_OPTIONS_EVENT_ID && config.LOCAL_TEST_OPTIONS_FIELD_KEY) {
    await runStep("XYOps dynamic options", async () => {
      const query = new URLSearchParams({
        eventId: config.LOCAL_TEST_OPTIONS_EVENT_ID,
        fieldKey: config.LOCAL_TEST_OPTIONS_FIELD_KEY,
        query: config.LOCAL_TEST_OPTIONS_QUERY || "",
      });
      const { body } = await requestJson(config, `/api/integrations/catalog/options?${query}`);
      if (!Array.isArray(body.options)) throw new Error("options response does not contain an array");
      return { count: body.options.length, sample: body.options.slice(0, 10) };
    });
  }

  if (parseBoolean(config.LOCAL_TEST_FREEIPA_MUTATIONS)) {
    const names = createTestNames(config.LOCAL_TEST_PREFIX);
    const password = `T-${randomBytes(18).toString("base64url")}`;
    let userCreated = false;
    let groupCreated = false;
    try {
      assertMutationAllowed(config, "FreeIPA mutation test");
      await runStep("FreeIPA create group", async () => {
        const result = await requestJson(config, "/api/integrations/freeipa/actions", { method: "POST", body: { operation: "group_add", group: names.group, description: "Portal local integration test" } });
        groupCreated = true;
        return { status: result.status, group: names.group };
      }, { fatal: true });
      await runStep("FreeIPA create user", async () => {
        const result = await requestJson(config, "/api/integrations/freeipa/actions", { method: "POST", body: { operation: "user_add", username: names.username, firstName: "Portal", lastName: "Integration", email: `${names.username}@example.test`, password } });
        userCreated = true;
        return { status: result.status, username: names.username };
      }, { fatal: true });
      await runStep("FreeIPA add membership", async () => {
        await requestJson(config, "/api/integrations/freeipa/actions", { method: "POST", body: { operation: "group_add_member", group: names.group, username: names.username } });
        return { username: names.username, group: names.group };
      }, { fatal: true });
      await runStep("FreeIPA disable and enable user", async () => {
        await requestJson(config, "/api/integrations/freeipa/actions", { method: "POST", body: { operation: "user_disable", username: names.username } });
        await requestJson(config, "/api/integrations/freeipa/actions", { method: "POST", body: { operation: "user_enable", username: names.username } });
        return { username: names.username };
      }, { fatal: true });
      await runStep("FreeIPA verify created objects", async () => {
        const users = (await requestJson(config, "/api/integrations/users")).body.users || [];
        const groups = (await requestJson(config, "/api/integrations/groups")).body.groups || [];
        if (!users.some((item) => item.uid === names.username)) throw new Error("created user is missing from user_find");
        if (!groups.some((item) => item.name === names.group)) throw new Error("created group is missing from group_find");
        return { username: names.username, group: names.group };
      }, { fatal: true });
    } finally {
      if (userCreated) await runStep("Cleanup FreeIPA user", async () => {
        await requestJson(config, "/api/integrations/freeipa/actions", { method: "POST", body: { operation: "user_del", username: names.username } });
        return { username: names.username };
      });
      if (groupCreated) await runStep("Cleanup FreeIPA group", async () => {
        await requestJson(config, "/api/integrations/freeipa/actions", { method: "POST", body: { operation: "group_del", group: names.group } });
        return { group: names.group };
      });
    }
  } else {
    report.steps.push({ name: "FreeIPA mutation test", outcome: "skipped", durationMs: 0, details: { reason: "LOCAL_TEST_FREEIPA_MUTATIONS is disabled" } });
  }

  if (parseBoolean(config.LOCAL_TEST_XYOPS_RUN)) {
    assertMutationAllowed(config, "XYOps run test");
    const eventId = String(config.LOCAL_TEST_XYOPS_EVENT_ID || "").trim();
    if (!eventId) throw new Error("LOCAL_TEST_XYOPS_EVENT_ID is required");
    if (catalogEvents.length && !catalogEvents.some((item) => item.id === eventId)) throw new Error(`XYOps process ${eventId} is absent from the catalog`);
    const values = parseJson(config.LOCAL_TEST_XYOPS_VALUES_JSON, {});
    const targets = parseJson(config.LOCAL_TEST_XYOPS_TARGETS_JSON, []);
    const launched = await runStep("XYOps launch dedicated test process", async () => {
      const { status, body } = await requestJson(config, "/api/integrations/catalog/run", { method: "POST", body: { eventId, values, targets } });
      if (status !== 202 || !body.jobId) throw new Error("dedicated test process must start immediately and return jobId; do not use a dangerous approval-gated process");
      return { status, eventId, jobId: body.jobId, runId: body.runId, state: body.status };
    }, { fatal: true });

    await runStep("XYOps launched job is visible", async () => {
      const waitTerminal = parseBoolean(config.LOCAL_TEST_XYOPS_WAIT_TERMINAL);
      const deadline = Date.now() + Math.max(5, Number(config.LOCAL_TEST_XYOPS_POLL_SECONDS || 60)) * 1000;
      let latest;
      while (Date.now() < deadline) {
        const body = (await requestJson(config, "/api/integrations/runs?sync=1")).body;
        latest = (body.runs || []).find((item) => item.jobId === launched.jobId || item.id === launched.runId);
        if (latest && (!waitTerminal || TERMINAL_STATUSES.has(latest.status))) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!latest) throw new Error("launched XYOps job did not appear in operation history");
      if (waitTerminal && !TERMINAL_STATUSES.has(latest.status)) throw new Error(`XYOps job did not reach a terminal status: ${latest.status}`);
      return { runId: latest.id, jobId: latest.jobId, status: latest.status, stages: latest.stages?.length || 0 };
    }, { fatal: true });
  } else {
    report.steps.push({ name: "XYOps run test", outcome: "skipped", durationMs: 0, details: { reason: "LOCAL_TEST_XYOPS_RUN is disabled" } });
  }

  report.finishedAt = new Date().toISOString();
  report.outcome = report.steps.some((step) => step.outcome === "failed") ? "failed" : "passed";
  const reportJson = `${JSON.stringify(redact(report), null, 2)}\n`;
  await writeFile(path.join(runDirectory, "report.json"), reportJson);
  await writeFile(path.join(runDirectory, "report.html"), renderHtml(report));
  await writeFile(path.join(artifactRoot, "latest.json"), reportJson);
  console.log(`REPORT_DIR=${runDirectory}`);
  if (report.outcome !== "passed") process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(`Local integration runner failed: ${safeText(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
  });
}
