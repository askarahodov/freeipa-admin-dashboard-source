/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import type { AutomationRoute, CatalogEvent, RouteField } from "../automation-types";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_VERIFY_TLS?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  XYOPS_EVENT_ID?: string;
  XYOPS_ROUTES_JSON?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  ADMIN_TOKEN?: string;
  DEMO_MODE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type RunStatus = "queued" | "running" | "success" | "failed" | "unknown";

type OperationRun = {
  id: string;
  jobId: string;
  eventId: string;
  title: string;
  kind: "event" | "workflow";
  mode: "demo" | "live";
  status: RunStatus;
  actor: string;
  subject: string;
  error: string;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type CatalogChange = { id: string; title: string; kind: "new" | "changed" | "removed" };
type CatalogSnapshot = { events: CatalogEvent[]; syncedAt: number };

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const runtimeEnv = env ?? (process.env as unknown as Env);

    if (url.pathname.startsWith("/api/integrations/")) {
      return handleIntegrationApi(request, runtimeEnv, url);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => runtimeEnv.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await runtimeEnv.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const createOperationRunsTable = `CREATE TABLE IF NOT EXISTS operation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  actor TEXT NOT NULL,
  subject TEXT NOT NULL,
  error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
)`;

const createCatalogSnapshotTable = `CREATE TABLE IF NOT EXISTS xyops_catalog_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  catalog_json TEXT NOT NULL,
  synced_at INTEGER NOT NULL
)`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function requestActor(request: Request): string {
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { return decodeURIComponent(encodedName).slice(0, 160); } catch {}
  }
  return (request.headers.get("oai-authenticated-user-email") || "portal-user").slice(0, 160);
}

function runStatus(value: unknown): RunStatus {
  const normalized = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["success", "succeeded", "completed", "complete", "done", "ok"].includes(normalized)) return "success";
  if (["failed", "failure", "error", "cancelled", "canceled", "timeout", "timed_out"].includes(normalized)) return "failed";
  if (["running", "active", "processing", "in_progress", "executing"].includes(normalized)) return "running";
  if (["queued", "pending", "created", "scheduled", "waiting"].includes(normalized)) return "queued";
  return "unknown";
}

function runSubject(values: Record<string, unknown>, targets: string[] = []): string {
  for (const key of ["username", "uid", "group", "database", "server", "hostname", "name"]) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  }
  return targets.filter(Boolean).slice(0, 3).join(", ").slice(0, 240) || "—";
}

function publicRun(run: OperationRun) {
  return { ...run, error: run.error || null };
}

async function ensureOperationRuns(env: Env): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createOperationRunsTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_runs_started_at_idx ON operation_runs(started_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS operation_runs_job_id_idx ON operation_runs(job_id)").run();
}

async function saveOperationRun(env: Env, run: OperationRun): Promise<void> {
  if (!env.DB) return;
  await ensureOperationRuns(env);
  await env.DB.prepare("INSERT INTO operation_runs (id, job_id, event_id, title, kind, mode, status, actor, subject, error, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, error = excluded.error, updated_at = excluded.updated_at, completed_at = excluded.completed_at")
    .bind(run.id, run.jobId, run.eventId, run.title, run.kind, run.mode, run.status, run.actor, run.subject, run.error || null, run.startedAt, run.updatedAt, run.completedAt).run();
}

async function listOperationRuns(env: Env, limit = 100): Promise<OperationRun[]> {
  if (!env.DB) return [];
  await ensureOperationRuns(env);
  const result = await env.DB.prepare("SELECT id, job_id, event_id, title, kind, mode, status, actor, subject, error, started_at, updated_at, completed_at FROM operation_runs ORDER BY started_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 200))).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({
    id: String(row.id ?? ""), jobId: String(row.job_id ?? ""), eventId: String(row.event_id ?? ""), title: String(row.title ?? ""),
    kind: row.kind === "workflow" ? "workflow" : "event", mode: row.mode === "demo" ? "demo" : "live", status: runStatus(row.status),
    actor: String(row.actor ?? "portal-user"), subject: String(row.subject ?? "—"), error: String(row.error ?? ""),
    startedAt: Number(row.started_at ?? 0), updatedAt: Number(row.updated_at ?? 0), completedAt: row.completed_at == null ? null : Number(row.completed_at),
  })).filter((run) => run.id);
}

function extractJobRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  for (const key of ["jobs", "active_jobs", "rows", "data", "result"]) if (source[key] !== payload) {
    const rows = extractJobRows(source[key]);
    if (rows.length) return rows;
  }
  return [];
}

async function syncOperationRuns(env: Env, xyopsUrl: string | null, runs: OperationRun[]): Promise<OperationRun[]> {
  if (!env.DB || !xyopsUrl || !env.XYOPS_API_KEY || !runs.some((run) => run.mode === "live" && ["queued", "running", "unknown"].includes(run.status))) return runs;
  try {
    const response = await fetch(`${xyopsUrl}/api/app/get_active_jobs/v1`, { headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return runs;
    const rows = extractJobRows(await response.json().catch(() => null));
    const byId = new Map(rows.map((row) => [String(row.job_id ?? row.jobId ?? row.id ?? ""), row]));
    const now = Date.now();
    for (const run of runs) {
      const row = byId.get(run.jobId);
      if (!row) continue;
      const nextStatus = runStatus(row.status ?? row.state ?? row.result ?? row.outcome);
      if (nextStatus === "unknown" || nextStatus === run.status) continue;
      run.status = nextStatus;
      run.updatedAt = now;
      if (nextStatus === "success" || nextStatus === "failed") run.completedAt = now;
      if (nextStatus === "failed") run.error = String(row.error ?? row.message ?? "XYOps job failed").slice(0, 500);
      await saveOperationRun(env, run);
    }
  } catch {}
  return runs;
}

async function readCatalogSnapshot(env: Env): Promise<CatalogSnapshot | null> {
  if (!env.DB) return null;
  await env.DB.prepare(createCatalogSnapshotTable).run();
  const row = await env.DB.prepare("SELECT catalog_json, synced_at FROM xyops_catalog_snapshot WHERE id = ?").bind("current").first<{ catalog_json: string; synced_at: number }>();
  if (!row) return null;
  try {
    const events = JSON.parse(row.catalog_json) as CatalogEvent[];
    return Array.isArray(events) ? { events: events.filter((event) => event && typeof event.id === "string"), syncedAt: Number(row.synced_at) } : null;
  } catch { return null; }
}

async function saveCatalogSnapshot(env: Env, events: CatalogEvent[], syncedAt: number): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createCatalogSnapshotTable).run();
  await env.DB.prepare("INSERT INTO xyops_catalog_snapshot (id, catalog_json, synced_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET catalog_json = excluded.catalog_json, synced_at = excluded.synced_at")
    .bind("current", JSON.stringify(events), syncedAt).run();
}

function catalogChanges(previous: CatalogEvent[], current: CatalogEvent[]): CatalogChange[] {
  const before = new Map(previous.map((event) => [event.id, event]));
  const after = new Map(current.map((event) => [event.id, event]));
  const changes: CatalogChange[] = [];
  for (const event of current) {
    const old = before.get(event.id);
    if (!old) changes.push({ id: event.id, title: event.title, kind: "new" });
    else if (JSON.stringify(old) !== JSON.stringify(event)) changes.push({ id: event.id, title: event.title, kind: "changed" });
  }
  for (const event of previous) if (!after.has(event.id)) changes.push({ id: event.id, title: event.title, kind: "removed" });
  return changes;
}

function cleanBaseUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return null;
    return parsed.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function reachable(url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000), redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function boolValue(value: unknown): boolean {
  const raw = firstValue(value);
  if (typeof raw === "boolean") return raw;
  return ["true", "1", "yes", "on"].includes(String(raw ?? "").toLowerCase());
}

type StoredConfig = {
  demoMode: boolean;
  ipaUrl: string;
  ipaUsername: string;
  xyopsUrl: string;
  routes?: AutomationRoute[];
};

type StoredSecrets = {
  ipaPassword: string;
  xyopsApiKey: string;
};

type StoredSettings = { config: StoredConfig; secrets: StoredSecrets; updatedAt: number };

const createSettingsTable = `CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL, updated_at INTEGER NOT NULL)`;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(value?: string): Promise<CryptoKey> {
  if (!value) throw new Error("CONFIG_ENCRYPTION_KEY is not configured");
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(value)) bytes = Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  else {
    try { bytes = base64ToBytes(value); } catch { throw new Error("CONFIG_ENCRYPTION_KEY must be 32-byte base64 or 64-character hex"); }
  }
  if (bytes.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecrets(secrets: StoredSecrets, keyValue?: string): Promise<string> {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(secrets)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSecrets(value: string, keyValue?: string): Promise<StoredSecrets> {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Unsupported encrypted settings format");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<StoredSecrets>;
  return { ipaPassword: String(parsed.ipaPassword ?? ""), xyopsApiKey: String(parsed.xyopsApiKey ?? "") };
}

async function adminAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const provided = request.headers.get("x-admin-token") ?? "";
  const [expectedHash, providedHash] = await Promise.all([crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.ADMIN_TOKEN)), crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided))]);
  const expected = new Uint8Array(expectedHash);
  const actual = new Uint8Array(providedHash);
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ (actual[index] ?? 0);
  return difference === 0;
}

async function readStoredSettings(env: Env): Promise<StoredSettings | null> {
  if (!env.DB) return null;
  await env.DB.prepare(createSettingsTable).run();
  const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?").bind("main").first<{ config_json: string; encrypted_secrets: string; updated_at: number }>();
  if (!row) return null;
  const config = JSON.parse(row.config_json) as Partial<StoredConfig>;
  const secrets = await decryptSecrets(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
  return { config: { demoMode: config.demoMode === true, ipaUrl: String(config.ipaUrl ?? ""), ipaUsername: String(config.ipaUsername ?? ""), xyopsUrl: String(config.xyopsUrl ?? ""), routes: Array.isArray(config.routes) ? sanitizeRoutes(config.routes) : undefined }, secrets, updatedAt: Number(row.updated_at) };
}

async function saveStoredSettings(env: Env, settings: StoredSettings): Promise<void> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const encryptedSecrets = await encryptSecrets(settings.secrets, env.CONFIG_ENCRYPTION_KEY);
  await env.DB.prepare(createSettingsTable).run();
  await env.DB.prepare("INSERT INTO app_settings (id, config_json, encrypted_secrets, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, encrypted_secrets = excluded.encrypted_secrets, updated_at = excluded.updated_at").bind("main", JSON.stringify(settings.config), encryptedSecrets, settings.updatedAt).run();
}

function envSettings(env: Env): StoredSettings {
  return { config: { demoMode: boolValue(env.DEMO_MODE), ipaUrl: cleanBaseUrl(env.IPA_URL) ?? "", ipaUsername: env.IPA_USERNAME ?? "", xyopsUrl: cleanBaseUrl(env.XYOPS_URL) ?? "", routes: undefined }, secrets: { ipaPassword: env.IPA_PASSWORD ?? "", xyopsApiKey: env.XYOPS_API_KEY ?? "" }, updatedAt: 0 };
}

async function effectiveSettings(env: Env): Promise<StoredSettings> {
  try { return await readStoredSettings(env) ?? envSettings(env); } catch { return envSettings(env); }
}

async function effectiveEnv(env: Env): Promise<Env> {
  const settings = await effectiveSettings(env);
  return { ...env, DEMO_MODE: settings.config.demoMode ? "true" : "false", IPA_URL: settings.config.ipaUrl, IPA_USERNAME: settings.config.ipaUsername, IPA_PASSWORD: settings.secrets.ipaPassword, XYOPS_URL: settings.config.xyopsUrl, XYOPS_API_KEY: settings.secrets.xyopsApiKey, XYOPS_ROUTES_JSON: settings.config.routes ? JSON.stringify(settings.config.routes) : env.XYOPS_ROUTES_JSON };
}

function publicSettings(settings: StoredSettings, env: Env, source: "database" | "environment") {
  return {
    source,
    persistenceAvailable: Boolean(env.DB),
    encryptionConfigured: Boolean(env.CONFIG_ENCRYPTION_KEY),
    updatedAt: settings.updatedAt || null,
    demoMode: settings.config.demoMode,
    freeipa: { url: settings.config.ipaUrl, username: settings.config.ipaUsername, passwordConfigured: Boolean(settings.secrets.ipaPassword) },
    xyops: { url: settings.config.xyopsUrl, apiKeyConfigured: Boolean(settings.secrets.xyopsApiKey) },
  };
}

function settingString(value: unknown, name: string, maxLength = 2048): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} is too long`);
  return normalized;
}

function mergeSettingsInput(current: StoredSettings, body: Record<string, unknown>): StoredSettings {
  const ipaUrlInput = body.ipaUrl === undefined ? current.config.ipaUrl : settingString(body.ipaUrl, "ipaUrl");
  const xyopsUrlInput = body.xyopsUrl === undefined ? current.config.xyopsUrl : settingString(body.xyopsUrl, "xyopsUrl");
  const ipaUrl = ipaUrlInput ? cleanBaseUrl(ipaUrlInput) : "";
  const xyopsUrl = xyopsUrlInput ? cleanBaseUrl(xyopsUrlInput) : "";
  if (ipaUrlInput && !ipaUrl) throw new Error("ipaUrl must be a valid HTTP(S) URL without credentials");
  if (xyopsUrlInput && !xyopsUrl) throw new Error("xyopsUrl must be a valid HTTP(S) URL without credentials");
  const ipaPassword = body.clearIpaPassword === true ? "" : typeof body.ipaPassword === "string" && body.ipaPassword ? body.ipaPassword.slice(0, 4096) : current.secrets.ipaPassword;
  const xyopsApiKey = body.clearXyopsApiKey === true ? "" : typeof body.xyopsApiKey === "string" && body.xyopsApiKey ? body.xyopsApiKey.slice(0, 4096) : current.secrets.xyopsApiKey;
  return {
    config: { demoMode: body.demoMode === undefined ? current.config.demoMode : body.demoMode === true, ipaUrl, ipaUsername: body.ipaUsername === undefined ? current.config.ipaUsername : settingString(body.ipaUsername, "ipaUsername", 256), xyopsUrl, routes: current.config.routes },
    secrets: { ipaPassword, xyopsApiKey },
    updatedAt: Date.now(),
  };
}

async function handleSettingsApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN is not configured on the server" }, 503);
  if (!await adminAuthorized(request, env)) return json({ error: "Administrator authorization required" }, 401);
  if (request.method === "GET" && url.pathname === "/api/integrations/settings") {
    try {
      const stored = await readStoredSettings(env);
      return json(publicSettings(stored ?? envSettings(env), env, stored ? "database" : "environment"));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot read settings" }, 500);
    }
  }
  if (request.method === "PUT" && url.pathname === "/api/integrations/settings") {
    if (!env.DB) return json({ error: "Persistent database is unavailable" }, 503);
    if (!env.CONFIG_ENCRYPTION_KEY) return json({ error: "CONFIG_ENCRYPTION_KEY is not configured" }, 503);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    try {
      const current = await readStoredSettings(env) ?? envSettings(env);
      const next = mergeSettingsInput(current, body);
      await saveStoredSettings(env, next);
      return json(publicSettings(next, env, "database"));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot save settings" }, 400);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/settings/test") {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    try {
      const current = await readStoredSettings(env) ?? envSettings(env);
      const draft = mergeSettingsInput(current, body);
      const service = body.service === "freeipa" ? "freeipa" : body.service === "xyops" ? "xyops" : null;
      if (!service) return json({ error: "service must be freeipa or xyops" }, 400);
      const started = Date.now();
      if (service === "freeipa") {
        if (!draft.config.ipaUrl || !draft.config.ipaUsername || !draft.secrets.ipaPassword) return json({ error: "FreeIPA settings are incomplete" }, 400);
        await ipaRpc({ ...env, IPA_USERNAME: draft.config.ipaUsername, IPA_PASSWORD: draft.secrets.ipaPassword }, draft.config.ipaUrl, "user_find", [""], { sizelimit: 1 });
      } else {
        if (!draft.config.xyopsUrl || !draft.secrets.xyopsApiKey) return json({ error: "XYOps settings are incomplete" }, 400);
        const response = await fetch(`${draft.config.xyopsUrl}/api/app/get_events/v1`, { method: "GET", headers: { "x-api-key": draft.secrets.xyopsApiKey, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("XYOps rejected the connection test");
      }
      return json({ ok: true, service, latencyMs: Date.now() - started });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Connection test failed" }, 502);
    }
  }
  return json({ error: "Not found" }, 404);
}

async function ipaRpc(env: Env, ipaUrl: string, method: string, args: unknown[] = [""], options: Record<string, unknown> = {}): Promise<Array<Record<string, unknown>>> {
  if (!env.IPA_USERNAME || !env.IPA_PASSWORD) throw new Error("FreeIPA credentials are not configured");
  const login = await fetch(`${ipaUrl}/ipa/session/login_password`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/plain", referer: `${ipaUrl}/ipa/ui/` },
    body: new URLSearchParams({ user: env.IPA_USERNAME, password: env.IPA_PASSWORD }),
    signal: AbortSignal.timeout(10000),
  });
  if (!login.ok) throw new Error("FreeIPA authentication failed");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("FreeIPA session cookie missing");
  const rpc = await fetch(`${ipaUrl}/ipa/session/json`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", referer: `${ipaUrl}/ipa/ui/`, cookie },
    body: JSON.stringify({ method, params: [args, options], id: 0 }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await rpc.json() as { result?: { result?: Array<Record<string, unknown>> }; error?: { message?: string } | null };
  if (!rpc.ok || payload.error) throw new Error(payload.error?.message ?? `${method} failed`);
  return payload.result?.result ?? [];
}

const allowedOperations = new Set(["user_add", "user_enable", "user_disable", "user_del", "group_add", "group_del", "group_add_member", "group_remove_member"]);

function sanitizeRoutes(raw: unknown): AutomationRoute[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error("routes must be an array with at most 100 items");
  const keys = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`routes[${index}] must be an object`);
    const source = item as Record<string, unknown>;
    const key = String(source.key ?? "").trim().slice(0, 120);
    const title = String(source.title ?? "").trim().slice(0, 240);
    const operation = String(source.operation ?? "");
    const kind = source.kind === "workflow" ? "workflow" : source.kind === "event" ? "event" : null;
    const eventId = String(source.eventId ?? "").trim().slice(0, 240);
    if (!key || keys.has(key) || !title || !eventId || !kind || !allowedOperations.has(operation)) throw new Error(`routes[${index}] is invalid or duplicated`);
    keys.add(key);
    const fields = Array.isArray(source.fields) ? source.fields.map(normalizeXyField).filter((field): field is RouteField => field !== null).slice(0, 100) : [];
    const targets = Array.isArray(source.targets) ? source.targets.map(String).map((value) => value.trim().slice(0, 240)).filter(Boolean).slice(0, 100) : [];
    return { key, title, operation, kind, eventId, enabled: source.enabled !== false, fields, targets };
  });
}

function automationRoutes(env: Env): AutomationRoute[] {
  const fallback: AutomationRoute[] = [
    { key: "user-create", title: "Создание пользователя", operation: "user_add", kind: "event", eventId: env.XYOPS_EVENT_ID ?? "freeipa-user-create", enabled: true, fields: [
      { key: "username", label: "Логин", type: "string", required: true, target: "params" },
      { key: "firstName", label: "Имя", type: "string", required: true, target: "params" },
      { key: "lastName", label: "Фамилия", type: "string", required: true, target: "params" },
      { key: "email", label: "Email", type: "string", target: "params" },
    ] },
    { key: "user-onboarding", title: "Полный onboarding", operation: "user_add", kind: "workflow", eventId: "freeipa-user-onboarding", enabled: true, fields: [
      { key: "username", label: "Логин", type: "string", required: true, target: "params" },
      { key: "firstName", label: "Имя", type: "string", required: true, target: "params" },
      { key: "lastName", label: "Фамилия", type: "string", required: true, target: "params" },
      { key: "department", label: "Отдел", type: "select", required: true, target: "workflowData", options: ["development", "devops", "security"] },
      { key: "sendWelcome", label: "Отправить приветствие", type: "boolean", target: "workflowData", default: true },
    ] },
    { key: "group-create", title: "Создание группы", operation: "group_add", kind: "event", eventId: "freeipa-group-create", enabled: true, fields: [
      { key: "group", label: "Группа", type: "string", required: true, target: "params" },
      { key: "description", label: "Описание", type: "string", target: "params" },
    ] },
  ];
  if (!env.XYOPS_ROUTES_JSON) {
    if (boolValue(env.DEMO_MODE)) return fallback;
    return env.XYOPS_EVENT_ID ? [fallback[0]] : [];
  }
  try {
    const parsed = JSON.parse(env.XYOPS_ROUTES_JSON) as AutomationRoute[];
    if (!Array.isArray(parsed)) return boolValue(env.DEMO_MODE) ? fallback : [];
    const valid = parsed.filter((route) => route && typeof route.key === "string" && typeof route.title === "string" && typeof route.eventId === "string" && (route.kind === "event" || route.kind === "workflow") && allowedOperations.has(route.operation));
    return valid;
  } catch {
    return boolValue(env.DEMO_MODE) ? fallback : [];
  }
}

function publicRoute(route: AutomationRoute) {
  return { key: route.key, title: route.title, operation: route.operation, kind: route.kind, eventId: route.eventId, enabled: route.enabled !== false, targets: route.targets ?? [], fields: route.fields ?? [] };
}

function fieldOptions(source: Record<string, unknown>): string[] | undefined {
  const raw = source.options ?? source.items ?? source.menu ?? source.values;
  if (!Array.isArray(raw)) return undefined;
  const values = raw.map((item) => {
    if (typeof item === "string" || typeof item === "number") return String(item);
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      return String(row.value ?? row.id ?? row.title ?? row.label ?? "");
    }
    return "";
  }).filter(Boolean);
  return values.length ? values : undefined;
}

function fieldCondition(source: Record<string, unknown>): RouteField["visibleWhen"] {
  const raw = source.visible_when ?? source.show_when ?? source.condition ?? source.depends_on;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const condition = raw as Record<string, unknown>;
  const field = String(condition.field ?? condition.key ?? condition.dependsOn ?? "").trim().slice(0, 120);
  if (!field) return undefined;
  const rawOperator = String(condition.operator ?? (condition.equals !== undefined ? "equals" : "truthy"));
  const operator: NonNullable<RouteField["visibleWhen"]>["operator"] = ["equals", "notEquals", "in", "truthy", "falsy"].includes(rawOperator) ? rawOperator as NonNullable<RouteField["visibleWhen"]>["operator"] : "equals";
  const rawValue = condition.value ?? condition.equals ?? condition.values;
  const value = Array.isArray(rawValue) ? rawValue.map(String).slice(0, 100) : rawValue === undefined ? undefined : String(rawValue);
  return { field, operator, value };
}

function fieldOptionsSource(source: Record<string, unknown>): RouteField["optionsSource"] {
  const raw = source.options_source ?? source.data_source;
  const nested = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const endpoint = String(source.options_endpoint ?? source.options_url ?? nested.endpoint ?? nested.url ?? "").trim();
  if (!endpoint.startsWith("/api/app/") || endpoint.includes("..") || endpoint.length > 240) return undefined;
  const queryParam = String(source.options_query_param ?? nested.queryParam ?? nested.query_param ?? "query").trim().slice(0, 80);
  return { endpoint, queryParam: queryParam || "query" };
}

function normalizeXyField(raw: unknown): RouteField | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const key = String(source.id ?? source.key ?? "").trim();
  if (!key || source.type === "hidden" || source.type === "group" || source.type === "section") return null;
  const xyType = String(source.type ?? "text").toLowerCase();
  const variant = String(source.variant ?? source.format ?? "").toLowerCase();
  let type: RouteField["type"] = "string";
  if (xyType === "checkbox" || xyType === "boolean") type = "boolean";
  else if (xyType === "multimenu" || xyType === "multiselect" || source.multiple === true) type = "multiselect";
  else if (xyType === "menu" || xyType === "select" || xyType === "radio") type = "select";
  else if (variant === "number" || xyType === "number") type = "number";
  else if (xyType === "password" || variant === "password" || source.secret === true) type = "password";
  else if (xyType === "textarea" || xyType === "multiline") type = "textarea";
  else if (xyType === "date" || variant === "date") type = "date";
  else if (["datetime", "datetime-local"].includes(xyType) || variant === "datetime") type = "datetime";
  else if (["json", "object", "array"].includes(xyType) || variant === "json") type = "json";
  const rawTarget = String(source.target ?? source.destination ?? source.scope ?? "params").toLowerCase();
  const target: RouteField["target"] = rawTarget.includes("workflow") ? "workflowData" : rawTarget.includes("input") ? "input" : "params";
  return {
    key,
    label: String(source.title ?? source.label ?? key),
    type,
    required: Boolean(source.required),
    target,
    options: fieldOptions(source),
    // Secret defaults must never be persisted in routes or returned to the browser.
    default: type === "password" ? undefined : (source.value ?? source.default) as string | number | boolean | string[] | undefined,
    description: String(source.description ?? source.help ?? source.hint ?? ""),
    placeholder: String(source.placeholder ?? ""),
    min: typeof source.min === "number" ? source.min : undefined,
    max: typeof source.max === "number" ? source.max : undefined,
    section: String(source.section ?? source.group ?? source.fieldset ?? "").trim().slice(0, 120) || undefined,
    order: typeof source.order === "number" ? source.order : typeof source.position === "number" ? source.position : undefined,
    visibleWhen: fieldCondition(source),
    optionsSource: fieldOptionsSource(source),
  };
}

function extractEventRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  for (const key of ["events", "rows", "data", "result"]) {
    if (Array.isArray(source[key])) return extractEventRows(source[key]);
  }
  return [];
}

function targetValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name ?? "") : "").filter(Boolean);
}

function catalogItem(event: Record<string, unknown>): CatalogEvent {
  const workflow = event.workflow && typeof event.workflow === "object" ? event.workflow as Record<string, unknown> : null;
  const kind = String(event.type ?? event.kind ?? "").toLowerCase() === "workflow" || Boolean(workflow) ? "workflow" : "event";
  const rawFields = [event.user_fields, event.fields, event.params, workflow?.user_fields, workflow?.fields].find(Array.isArray) as unknown[] | undefined;
  const id = String(event.id ?? event.event_id ?? workflow?.id ?? "");
  return {
    id,
    title: String(event.title ?? event.name ?? workflow?.title ?? (id || "Untitled")),
    description: String(event.description ?? event.help ?? workflow?.description ?? ""),
    kind,
    enabled: event.enabled !== false,
    category: String(event.category ?? "general"),
    plugin: kind === "workflow" ? null : String(event.plugin ?? ""),
    fields: (rawFields ?? []).map(normalizeXyField).filter((field): field is RouteField => field !== null),
    targets: targetValues(event.targets ?? event.target_options),
    dangerous: Boolean(event.dangerous ?? event.requires_confirmation),
  };
}

function demoCatalog(env: Env): CatalogEvent[] {
  const routeEvents = automationRoutes(env).map((route) => ({ id: route.eventId, title: route.title, description: "Маршрут администрирования FreeIPA", kind: route.kind, enabled: route.enabled !== false, category: "FreeIPA", plugin: route.kind === "workflow" ? null : "freeipa", fields: route.fields ?? [], targets: route.targets ?? [], dangerous: false }));
  return [...routeEvents, { id: "database-backup", title: "Резервное копирование базы данных", description: "Создание и проверка резервной копии выбранной БД", kind: "workflow", enabled: true, category: "Databases", plugin: null, targets: ["db-prod-01", "db-stage-01"], dangerous: false, fields: [
    { key: "database", label: "База данных", type: "string", required: true, target: "workflowData", placeholder: "billing" },
    { key: "backupType", label: "Тип копии", type: "select", required: true, target: "workflowData", options: ["full", "incremental"], default: "full" },
    { key: "retentionDays", label: "Хранить, дней", type: "number", required: true, target: "workflowData", default: 14, min: 1, max: 365 },
    { key: "verify", label: "Проверить копию после создания", type: "boolean", target: "workflowData", default: true },
  ] }];
}

async function loadCatalog(env: Env, xyopsUrl: string | null): Promise<{ mode: "demo" | "live" | "unconfigured"; events: CatalogEvent[] }> {
  if (boolValue(env.DEMO_MODE)) return { mode: "demo", events: demoCatalog(env) };
  if (!xyopsUrl || !env.XYOPS_API_KEY) return { mode: "unconfigured", events: [] };
  const response = await fetch(`${xyopsUrl}/api/app/get_events/v1`, { method: "GET", headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("XYOps get_events failed");
  return { mode: "live", events: extractEventRows(payload).map(catalogItem).filter((event) => event.id) };
}

async function portalCatalog(env: Env, xyopsUrl: string | null): Promise<{ mode: "demo" | "live" | "cached" | "unconfigured"; source: "demo" | "xyops" | "cache" | "none"; events: CatalogEvent[]; syncedAt: string | null; stale: boolean; changes: CatalogChange[] }> {
  if (boolValue(env.DEMO_MODE)) return { mode: "demo", source: "demo", events: demoCatalog(env), syncedAt: new Date().toISOString(), stale: false, changes: [] };
  const previous = await readCatalogSnapshot(env).catch(() => null);
  if (!xyopsUrl || !env.XYOPS_API_KEY) return previous
    ? { mode: "cached", source: "cache", events: previous.events, syncedAt: new Date(previous.syncedAt).toISOString(), stale: true, changes: [] }
    : { mode: "unconfigured", source: "none", events: [], syncedAt: null, stale: false, changes: [] };
  try {
    const live = await loadCatalog(env, xyopsUrl);
    const events = [...live.events].sort((left, right) => `${left.category}\0${left.title}\0${left.id}`.localeCompare(`${right.category}\0${right.title}\0${right.id}`));
    const syncedAt = Date.now();
    const changes = previous ? catalogChanges(previous.events, events) : events.map((event) => ({ id: event.id, title: event.title, kind: "new" as const }));
    await saveCatalogSnapshot(env, events, syncedAt);
    return { mode: "live", source: "xyops", events, syncedAt: new Date(syncedAt).toISOString(), stale: false, changes };
  } catch (error) {
    if (previous) return { mode: "cached", source: "cache", events: previous.events, syncedAt: new Date(previous.syncedAt).toISOString(), stale: true, changes: [] };
    throw error;
  }
}

function coerceField(field: RouteField, raw: unknown): unknown | null {
  if ((raw === undefined || raw === null || raw === "") && field.default !== undefined) raw = field.default;
  if (raw === undefined || raw === null || raw === "") return field.required ? null : "";
  if (field.type === "boolean") return raw === true || raw === "true" || raw === "1" || raw === "on";
  if (field.type === "number") { const number = Number(raw); return Number.isFinite(number) && (field.min === undefined || number >= field.min) && (field.max === undefined || number <= field.max) ? number : null; }
  if (field.type === "multiselect") {
    const values = Array.isArray(raw) ? raw.map(String) : String(raw).split(",").map((value) => value.trim()).filter(Boolean);
    return field.options && values.some((value) => !field.options?.includes(value)) ? null : values;
  }
  if (field.type === "json") {
    if (typeof raw !== "string") return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }
  const value = String(raw).slice(0, 2048);
  if (field.type === "select" && field.options && !field.options.includes(value)) return null;
  return value;
}

function fieldVisible(field: RouteField, values: Record<string, unknown>): boolean {
  const condition = field.visibleWhen;
  if (!condition) return true;
  const current = values[condition.field];
  const truthy = current === true || current === "true" || current === "1" || current === "on" || Array.isArray(current) && current.length > 0 || typeof current === "string" && current.trim().length > 0;
  if (condition.operator === "truthy") return truthy;
  if (condition.operator === "falsy") return !truthy;
  const actual = Array.isArray(current) ? current.map(String) : String(current ?? "");
  const expected = Array.isArray(condition.value) ? condition.value.map(String) : String(condition.value ?? "");
  if (condition.operator === "in") return Array.isArray(expected) && (Array.isArray(actual) ? actual.some((value) => expected.includes(value)) : expected.includes(actual));
  const equal = Array.isArray(actual) ? actual.includes(String(expected)) : actual === expected;
  return condition.operator === "notEquals" ? !equal : equal;
}

function extractOptionValues(payload: unknown): string[] {
  if (Array.isArray(payload)) return payload.map((item) => {
    if (typeof item === "string" || typeof item === "number") return String(item);
    if (item && typeof item === "object") { const row = item as Record<string, unknown>; return String(row.value ?? row.id ?? row.name ?? row.title ?? row.label ?? ""); }
    return "";
  }).filter(Boolean).slice(0, 500);
  if (!payload || typeof payload !== "object") return [];
  const source = payload as Record<string, unknown>;
  for (const key of ["options", "items", "values", "rows", "data", "result"]) {
    if (source[key] === payload) continue;
    const values = extractOptionValues(source[key]);
    if (values.length) return values;
  }
  return [];
}

function operationRun(input: {
  request: Request;
  eventId: string;
  title: string;
  kind: "event" | "workflow";
  mode: "demo" | "live";
  jobId: string;
  status: RunStatus;
  values?: Record<string, unknown>;
  targets?: string[];
  error?: string;
}): OperationRun {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), jobId: input.jobId || `LOCAL-${now}`, eventId: input.eventId, title: input.title,
    kind: input.kind, mode: input.mode, status: input.status, actor: requestActor(input.request),
    subject: runSubject(input.values ?? {}, input.targets), error: (input.error ?? "").slice(0, 500),
    startedAt: now, updatedAt: now, completedAt: input.status === "success" || input.status === "failed" ? now : null,
  };
}

async function handleIntegrationApi(request: Request, baseEnv: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/integrations/settings" || url.pathname === "/api/integrations/settings/test") return handleSettingsApi(request, baseEnv, url);
  const env = await effectiveEnv(baseEnv);
  const ipaUrl = cleanBaseUrl(env.IPA_URL);
  const xyopsUrl = cleanBaseUrl(env.XYOPS_URL);

  if (request.method === "GET" && url.pathname === "/api/integrations/status") {
    const demoMode = boolValue(env.DEMO_MODE);
    const ipaConfigured = Boolean(ipaUrl && env.IPA_USERNAME && env.IPA_PASSWORD);
    const xyopsConfigured = Boolean(xyopsUrl && env.XYOPS_API_KEY);
    const [ipaReachable, xyopsReachable] = await Promise.all([!demoMode && ipaConfigured ? reachable(ipaUrl) : false, !demoMode && xyopsConfigured ? reachable(xyopsUrl) : false]);
    return json({ mode: demoMode ? "demo" : ipaConfigured || xyopsConfigured ? "live" : "unconfigured", viewer: requestActor(request), persistence: { available: Boolean(baseEnv.DB), configured: Boolean(baseEnv.CONFIG_ENCRYPTION_KEY) }, freeipa: { configured: ipaConfigured, reachable: ipaReachable }, xyops: { configured: xyopsConfigured, reachable: xyopsReachable } });
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    let runs = await listOperationRuns(baseEnv, Number.isFinite(limit) ? limit : 100);
    if (url.searchParams.get("sync") !== "0") runs = await syncOperationRuns(env, xyopsUrl, runs);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayRuns = runs.filter((run) => run.startedAt >= today.getTime());
    return json({ persistenceAvailable: Boolean(baseEnv.DB), runs: runs.map(publicRun), stats: {
      today: todayRuns.length,
      queued: todayRuns.filter((run) => run.status === "queued" || run.status === "running").length,
      success: todayRuns.filter((run) => run.status === "success").length,
      failed: todayRuns.filter((run) => run.status === "failed").length,
    } });
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/routes") {
    const routes = automationRoutes(env);
    return json({ mode: boolValue(env.DEMO_MODE) ? "demo" : routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });
  }

  if (request.method === "PUT" && url.pathname === "/api/integrations/routes") {
    if (!baseEnv.ADMIN_TOKEN || !await adminAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (!baseEnv.DB || !baseEnv.CONFIG_ENCRYPTION_KEY) return json({ error: "Persistent encrypted storage is unavailable" }, 503);
    try {
      const body = await request.json() as Record<string, unknown>;
      const routes = sanitizeRoutes(body.routes);
      const current = await readStoredSettings(baseEnv) ?? envSettings(baseEnv);
      const next = { ...current, config: { ...current.config, routes }, updatedAt: Date.now() };
      await saveStoredSettings(baseEnv, next);
      return json({ mode: routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot save routes" }, 400);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/catalog") {
    try {
      return json(await portalCatalog(env, xyopsUrl));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "XYOps catalog request failed" }, 502);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/catalog/options") {
    if (!xyopsUrl || !env.XYOPS_API_KEY) return json({ error: "XYOps is not configured" }, 503);
    try {
      const catalog = await loadCatalog(env, xyopsUrl);
      const event = catalog.events.find((item) => item.id === url.searchParams.get("eventId"));
      const field = event?.fields.find((item) => item.key === url.searchParams.get("fieldKey"));
      if (!field?.optionsSource) return json({ error: "Dynamic option source not found" }, 404);
      const endpoint = new URL(`${xyopsUrl}${field.optionsSource.endpoint}`);
      const query = String(url.searchParams.get("query") ?? "").slice(0, 200);
      if (query) endpoint.searchParams.set(field.optionsSource.queryParam ?? "query", query);
      const response = await fetch(endpoint, { headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return json({ error: "XYOps option provider failed" }, 502);
      return json({ options: extractOptionValues(await response.json().catch(() => null)) });
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load options" }, 502); }
  }

  if (request.method === "POST" && url.pathname === "/api/integrations/catalog/run") {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
    try {
      const catalog = await loadCatalog(env, xyopsUrl);
      if (catalog.mode === "unconfigured") return json({ error: "XYOps is not configured" }, 503);
      const event = catalog.events.find((item) => item.id === eventId && item.enabled);
      if (!event) return json({ error: "XYOps process not found or disabled" }, 404);
      const requestedTargets = Array.isArray(body.targets) ? body.targets.map(String) : [];
      if (event.targets.length && requestedTargets.some((target) => !event.targets.includes(target))) return json({ error: "Unsupported target" }, 400);
      const params: Record<string, unknown> = { source: "xyops-self-service" };
      const inputData: Record<string, unknown> = { source: "xyops-self-service" };
      const workflowData: Record<string, unknown> = {};
      for (const field of event.fields) {
        if (!fieldVisible(field, values)) continue;
        const value = coerceField(field, values[field.key]);
        if (value === null) return json({ error: `Invalid or missing field: ${field.key}` }, 400);
        if (value === "" && !field.required) continue;
        if (field.target === "workflowData") workflowData[field.key] = value;
        else if (field.target === "input") inputData[field.key] = value;
        else params[field.key] = value;
      }
      const launchPayload = { id: event.id, params, input: { data: inputData }, ...(event.kind === "workflow" ? { workflowData } : {}), ...(requestedTargets.length ? { targets: requestedTargets } : event.targets.length === 1 ? { targets: event.targets } : {}) };
      if (catalog.mode === "demo" || !xyopsUrl || !env.XYOPS_API_KEY) {
        const run = operationRun({ request, eventId: event.id, title: event.title, kind: event.kind, mode: "demo", jobId: `DEMO-${Date.now()}`, status: "success", values, targets: requestedTargets });
        await saveOperationRun(baseEnv, run);
        return json({ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);
      }
      const response = await fetch(`${xyopsUrl}/api/app/run_event/v1`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY }, body: JSON.stringify(launchPayload), signal: AbortSignal.timeout(15000) });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      const resultData = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
      const jobId = String(result.job_id ?? result.jobId ?? result.id ?? resultData.job_id ?? "");
      if (!response.ok) {
        const run = operationRun({ request, eventId: event.id, title: event.title, kind: event.kind, mode: "live", jobId, status: "failed", values, targets: requestedTargets, error: "XYOps rejected run_event" });
        await saveOperationRun(baseEnv, run);
        return json({ error: "XYOps run_event failed", runId: run.id }, 502);
      }
      const reported = runStatus(result.status ?? result.state ?? resultData.status ?? resultData.state);
      const run = operationRun({ request, eventId: event.id, title: event.title, kind: event.kind, mode: "live", jobId, status: reported === "unknown" ? "queued" : reported, values, targets: requestedTargets });
      await saveOperationRun(baseEnv, run);
      return json({ mode: "live", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: event.title, kind: event.kind } }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "XYOps request failed";
      const run = operationRun({ request, eventId: eventId || "unknown", title: eventId || "XYOps process", kind: "event", mode: "live", jobId: "", status: "failed", values, error: message });
      await saveOperationRun(baseEnv, run);
      return json({ error: message, runId: run.id }, 502);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/users") {
    if (boolValue(env.DEMO_MODE)) return json({ mode: "demo", users: [] });
    if (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD) return json({ mode: "unconfigured", users: [] });
    try {
      const list = await ipaRpc(env, ipaUrl, "user_find", [""], { all: true, sizelimit: 0 });
      const users = list.map((entry) => ({
        uid: String(firstValue(entry.uid) ?? ""),
        name: String(firstValue(entry.cn) ?? firstValue(entry.displayname) ?? firstValue(entry.uid) ?? ""),
        email: String(firstValue(entry.mail) ?? ""),
        active: !boolValue(entry.nsaccountlock),
        groups: Array.isArray(entry.memberof_group) ? entry.memberof_group.length : 0,
      })).filter((user) => user.uid);
      return json({ mode: "live", users });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "FreeIPA request failed" }, 502);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/groups") {
    if (boolValue(env.DEMO_MODE)) return json({ mode: "demo", groups: [] });
    if (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD) return json({ mode: "unconfigured", groups: [] });
    try {
      const list = await ipaRpc(env, ipaUrl, "group_find", [""], { all: true, sizelimit: 0 });
      const groups = list.map((entry) => ({
        name: String(firstValue(entry.cn) ?? ""),
        description: String(firstValue(entry.description) ?? "Без описания"),
        members: Array.isArray(entry.member_user) ? entry.member_user.length : 0,
        type: firstValue(entry.gidnumber) ? "POSIX" : "Non-POSIX",
      })).filter((group) => group.name);
      return json({ mode: "live", groups });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "FreeIPA request failed" }, 502);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/integrations/actions") {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    if (typeof body.operation !== "string" || !allowedOperations.has(body.operation)) return json({ error: "Unsupported operation" }, 400);
    const routes = automationRoutes(env);
    const route = typeof body.routeKey === "string" ? routes.find((item) => item.key === body.routeKey) : routes.find((item) => item.operation === body.operation && item.enabled !== false);
    if (!route || route.enabled === false || route.operation !== body.operation) return json({ error: "Automation route not found" }, 400);
    const params: Record<string, unknown> = { operation: body.operation, source: "freeipa-admin-dashboard" };
    const inputData: Record<string, unknown> = { source: "freeipa-admin-dashboard", operation: body.operation };
    const workflowData: Record<string, unknown> = {};
    for (const field of route.fields ?? []) {
      const value = coerceField(field, body[field.key]);
      if (value === null) return json({ error: `Invalid or missing field: ${field.key}` }, 400);
      if (value === "" && !field.required) continue;
      const target = field.target ?? "params";
      if (target === "input") inputData[field.key] = value;
      else if (target === "workflowData") workflowData[field.key] = value;
      else params[field.key] = value;
    }
    if (boolValue(env.DEMO_MODE)) {
      const run = operationRun({ request, eventId: route.eventId, title: route.title, kind: route.kind, mode: "demo", jobId: `DEMO-${Date.now()}`, status: "success", values: body, targets: route.targets ?? [] });
      await saveOperationRun(baseEnv, run);
      return json({ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status }, 202);
    }
    if (!xyopsUrl || !env.XYOPS_API_KEY) return json({ error: "XYOps is not configured" }, 503);
    try {
      const response = await fetch(`${xyopsUrl}/api/app/run_event/v1`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY },
        body: JSON.stringify({ id: route.eventId, params, input: { data: inputData }, ...(route.kind === "workflow" ? { workflowData } : {}), ...(route.targets?.length ? { targets: route.targets } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => ({}));
      const resultRecord = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const resultData = resultRecord.data && typeof resultRecord.data === "object" ? resultRecord.data as Record<string, unknown> : {};
      const jobId = String(resultRecord.job_id ?? resultRecord.jobId ?? resultRecord.id ?? resultData.job_id ?? "");
      const reported = runStatus(resultRecord.status ?? resultRecord.state ?? resultData.status ?? resultData.state);
      const run = operationRun({ request, eventId: route.eventId, title: route.title, kind: route.kind, mode: "live", jobId, status: response.ok ? reported === "unknown" ? "queued" : reported : "failed", values: body, targets: route.targets ?? [], error: response.ok ? "" : "XYOps rejected run_event" });
      await saveOperationRun(baseEnv, run);
      return json({ mode: "live", queued: response.ok, runId: run.id, jobId: run.jobId, status: run.status, ...(response.ok ? {} : { error: "XYOps run_event failed" }) }, response.ok ? 202 : 502);
    } catch (error) {
      const message = error instanceof Error ? error.message : "XYOps request failed";
      const run = operationRun({ request, eventId: route.eventId, title: route.title, kind: route.kind, mode: "live", jobId: "", status: "failed", values: body, targets: route.targets ?? [], error: message });
      await saveOperationRun(baseEnv, run);
      return json({ error: message, runId: run.id }, 502);
    }
  }

  return json({ error: "Not found" }, 404);
}

export default worker;
