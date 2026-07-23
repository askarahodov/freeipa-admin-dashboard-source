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
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
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
type RunStage = { id: string; title: string; status: RunStatus; startedAt: number | null; completedAt: number | null; error: string };

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
  stages: RunStage[];
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type CatalogChange = { id: string; title: string; kind: "new" | "changed" | "removed" };
type CatalogSnapshot = { events: CatalogEvent[]; syncedAt: number };
type CatalogHistoryEntry = { id: string; syncedAt: number; changes: CatalogChange[]; processCount: number };

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
  stages_json TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
)`;

const createCatalogSnapshotTable = `CREATE TABLE IF NOT EXISTS xyops_catalog_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  catalog_json TEXT NOT NULL,
  synced_at INTEGER NOT NULL
)`;
const createCatalogHistoryTable = `CREATE TABLE IF NOT EXISTS xyops_catalog_history (
  id TEXT PRIMARY KEY NOT NULL,
  synced_at INTEGER NOT NULL,
  changes_json TEXT NOT NULL,
  catalog_json TEXT NOT NULL
)`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function xyopsPayloadSucceeded(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const code = (payload as Record<string, unknown>).code;
  return typeof code !== "number" || code === 0;
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

function jobLifecycleStatus(row: Record<string, unknown>, active = false): RunStatus {
  const completed = Number(row.completed ?? row.completed_at ?? row.finished_at ?? 0);
  if (Number.isFinite(completed) && completed > 0) {
    const code = row.code ?? row.exit_code ?? row.exitCode;
    return code === undefined || code === null || code === 0 || code === false || code === "0" || code === "" ? "success" : "failed";
  }
  const lifecycle = runStatus(row.state ?? row.lifecycle_status ?? row.lifecycleStatus ?? row.outcome);
  if (lifecycle !== "unknown") return lifecycle;
  const reported = runStatus(row.status);
  if (reported !== "unknown") return reported;
  return active ? "running" : "unknown";
}

function jobTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  await env.DB.prepare("INSERT INTO operation_runs (id, job_id, event_id, title, kind, mode, status, actor, subject, error, stages_json, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, error = excluded.error, stages_json = excluded.stages_json, updated_at = excluded.updated_at, completed_at = excluded.completed_at")
    .bind(run.id, run.jobId, run.eventId, run.title, run.kind, run.mode, run.status, run.actor, run.subject, run.error || null, JSON.stringify(run.stages), run.startedAt, run.updatedAt, run.completedAt).run();
}

async function listOperationRuns(env: Env, limit = 100): Promise<OperationRun[]> {
  if (!env.DB) return [];
  await ensureOperationRuns(env);
  const result = await env.DB.prepare("SELECT id, job_id, event_id, title, kind, mode, status, actor, subject, error, stages_json, started_at, updated_at, completed_at FROM operation_runs ORDER BY started_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 200))).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({
    id: String(row.id ?? ""), jobId: String(row.job_id ?? ""), eventId: String(row.event_id ?? ""), title: String(row.title ?? ""),
    kind: row.kind === "workflow" ? "workflow" : "event", mode: row.mode === "demo" ? "demo" : "live", status: runStatus(row.status),
    actor: String(row.actor ?? "portal-user"), subject: String(row.subject ?? "—"), error: String(row.error ?? ""),
    stages: (() => { try { const stages = JSON.parse(String(row.stages_json ?? "[]")); return Array.isArray(stages) ? stages.slice(0, 100) as RunStage[] : []; } catch { return []; } })(),
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

function extractJobStages(row: Record<string, unknown>): RunStage[] {
  const raw = [row.stages, row.steps, row.tasks, row.nodes, row.workflow_steps].find(Array.isArray) as unknown[] | undefined;
  if (!raw) return [];
  const timestamp = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
    return null;
  };
  return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).slice(0, 100).map((stage, index) => ({
    id: String(stage.id ?? stage.step_id ?? stage.key ?? index).slice(0, 160),
    title: String(stage.title ?? stage.name ?? stage.label ?? `Этап ${index + 1}`).slice(0, 240),
    status: runStatus(stage.status ?? stage.state ?? stage.result),
    startedAt: timestamp(stage.started_at ?? stage.startedAt),
    completedAt: timestamp(stage.completed_at ?? stage.completedAt ?? stage.finished_at),
    error: String(stage.error ?? stage.message ?? "").slice(0, 500),
  }));
}

async function syncOperationRuns(env: Env, xyopsUrl: string | null, runs: OperationRun[]): Promise<OperationRun[]> {
  if (!env.DB || !xyopsUrl || !env.XYOPS_API_KEY || !runs.some((run) => run.mode === "live" && ["queued", "running", "unknown"].includes(run.status))) return runs;
  try {
    const response = await fetch(`${xyopsUrl}/api/app/get_active_jobs/v1`, { headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return runs;
    const rows = extractJobRows(await response.json().catch(() => null));
    const byId = new Map(rows.map((row) => [String(row.job_id ?? row.jobId ?? row.id ?? ""), row]));
    const unresolved = runs.filter((run) => run.mode === "live" && ["queued", "running", "unknown"].includes(run.status) && run.jobId && !byId.has(run.jobId));
    if (unresolved.length) {
      const ids = unresolved.slice(0, 100).map((run) => run.jobId);
      try {
        const detailsResponse = await fetch(`${xyopsUrl}/api/app/get_jobs/v1`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY, accept: "application/json" },
          body: JSON.stringify({ ids, verbose: false }),
          signal: AbortSignal.timeout(12000),
        });
        const detailsPayload = await detailsResponse.json().catch(() => null) as Record<string, unknown> | null;
        if (detailsResponse.ok && detailsPayload && xyopsPayloadSucceeded(detailsPayload) && Array.isArray(detailsPayload.jobs)) {
          for (const row of detailsPayload.jobs) {
            if (!row || typeof row !== "object" || Array.isArray(row) || "err" in row) continue;
            const record = row as Record<string, unknown>;
            const id = String(record.job_id ?? record.jobId ?? record.id ?? "");
            if (id) byId.set(id, record);
          }
        }
      } catch {}
    }
    const now = Date.now();
    for (const run of runs) {
      const row = byId.get(run.jobId);
      if (!row) continue;
      const nextStatus = jobLifecycleStatus(row, rows.includes(row));
      const nextStages = extractJobStages(row);
      const stagesChanged = nextStages.length > 0 && JSON.stringify(nextStages) !== JSON.stringify(run.stages);
      if ((nextStatus === "unknown" || nextStatus === run.status) && !stagesChanged) continue;
      if (nextStatus !== "unknown") run.status = nextStatus;
      if (nextStages.length) run.stages = nextStages;
      run.updatedAt = now;
      if (nextStatus === "success" || nextStatus === "failed") run.completedAt = jobTimestamp(row.completed ?? row.completed_at ?? row.finished_at) ?? now;
      if (nextStatus === "failed") run.error = String(row.description ?? row.error ?? row.message ?? "XYOps job failed").slice(0, 500);
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

async function saveCatalogHistory(env: Env, events: CatalogEvent[], changes: CatalogChange[], syncedAt: number): Promise<void> {
  if (!env.DB || !changes.length) return;
  await env.DB.prepare(createCatalogHistoryTable).run();
  await env.DB.prepare("INSERT INTO xyops_catalog_history (id, synced_at, changes_json, catalog_json) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), syncedAt, JSON.stringify(changes), JSON.stringify(events)).run();
  await env.DB.prepare("DELETE FROM xyops_catalog_history WHERE id NOT IN (SELECT id FROM xyops_catalog_history ORDER BY synced_at DESC LIMIT 30)").run();
}

async function listCatalogHistory(env: Env, limit = 20): Promise<CatalogHistoryEntry[]> {
  if (!env.DB) return [];
  await env.DB.prepare(createCatalogHistoryTable).run();
  const result = await env.DB.prepare("SELECT id, synced_at, changes_json, catalog_json FROM xyops_catalog_history ORDER BY synced_at DESC LIMIT ?").bind(Math.max(1, Math.min(limit, 30))).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => {
    let changes: CatalogChange[] = []; let processCount = 0;
    try { const parsed = JSON.parse(String(row.changes_json ?? "[]")); if (Array.isArray(parsed)) changes = parsed.slice(0, 500); } catch {}
    try { const parsed = JSON.parse(String(row.catalog_json ?? "[]")); if (Array.isArray(parsed)) processCount = parsed.length; } catch {}
    return { id: String(row.id ?? ""), syncedAt: Number(row.synced_at ?? 0), changes, processCount };
  }).filter((entry) => entry.id);
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
  const normalized = value?.trim();
  if (!normalized) throw new Error("CONFIG_ENCRYPTION_KEY is not configured");
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(normalized)) bytes = Uint8Array.from(normalized.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  else {
    try { bytes = base64ToBytes(normalized); } catch { throw new Error("CONFIG_ENCRYPTION_KEY must be 32-byte base64 or 64-character hex"); }
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
        const payload = await response.json().catch(() => null);
        if (!response.ok || !xyopsPayloadSucceeded(payload)) throw new Error("XYOps rejected the connection test");
      }
      return json({ ok: true, service, latencyMs: Date.now() - started });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Connection test failed" }, 502);
    }
  }
  return json({ error: "Not found" }, 404);
}

function freeIpaNetworkError(error: unknown, stage: "вход" | "JSON-RPC" | "Node Gateway"): Error {
  const name = error instanceof Error ? error.name : "RequestError";
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : null;
  const rawCode = cause && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : "";
  const code = typeof rawCode === "string" && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : "";
  if (name === "TimeoutError" || name === "AbortError" || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return new Error(`Таймаут подключения к FreeIPA на этапе «${stage}»`);
  if (["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) return new Error(`TLS-сертификат FreeIPA не принят средой портала (${code})`);
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return new Error(`DNS-имя FreeIPA не разрешается из среды портала (${code})`);
  if (["ECONNREFUSED", "ECONNRESET"].includes(code)) return new Error(`FreeIPA разорвал или отклонил соединение на этапе «${stage}» (${code})`);
  return new Error(`FreeIPA недоступен из среды портала на этапе «${stage}»: проверьте публичный DNS, TLS-сертификат, firewall и доступ к /ipa/session/*`);
}

async function freeIpaFetch(url: string, init: RequestInit, stage: "вход" | "JSON-RPC"): Promise<Response> {
  try { return await fetch(url, init); }
  catch (error) { throw freeIpaNetworkError(error, stage); }
}

async function ipaRpc(env: Env, ipaUrl: string, method: string, args: unknown[] = [""], options: Record<string, unknown> = {}): Promise<Array<Record<string, unknown>>> {
  if (!env.IPA_USERNAME || !env.IPA_PASSWORD) throw new Error("FreeIPA credentials are not configured");
  if (env.IPA_NODE_GATEWAY_URL && env.IPA_NODE_GATEWAY_TOKEN) {
    let gatewayResponse: Response;
    try {
      gatewayResponse = await fetch(`${env.IPA_NODE_GATEWAY_URL}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.IPA_NODE_GATEWAY_TOKEN}` },
        body: JSON.stringify({ ipaUrl, username: env.IPA_USERNAME, password: env.IPA_PASSWORD, method, args, options }),
        signal: AbortSignal.timeout(35000),
      });
    } catch (error) { throw freeIpaNetworkError(error, "Node Gateway"); }
    const gatewayPayload = await gatewayResponse.json().catch(() => null) as { result?: Array<Record<string, unknown>>; error?: string } | null;
    if (!gatewayResponse.ok) throw new Error(gatewayPayload?.error || `FreeIPA Node Gateway вернул HTTP ${gatewayResponse.status}`);
    return Array.isArray(gatewayPayload?.result) ? gatewayPayload.result : [];
  }
  const login = await freeIpaFetch(`${ipaUrl}/ipa/session/login_password`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/plain", referer: `${ipaUrl}/ipa/ui/` },
    body: new URLSearchParams({ user: env.IPA_USERNAME, password: env.IPA_PASSWORD }),
    signal: AbortSignal.timeout(10000),
    redirect: "manual",
  }, "вход");
  if (login.status >= 300 && login.status < 400) throw new Error(`FreeIPA перенаправляет endpoint входа (HTTP ${login.status}); укажите конечный HTTPS-адрес сервера`);
  if (login.status === 401 || login.status === 403) throw new Error(`FreeIPA отклонил учётные данные (HTTP ${login.status})`);
  if (!login.ok) throw new Error(`Endpoint входа FreeIPA вернул HTTP ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("FreeIPA session cookie missing");
  const rpc = await freeIpaFetch(`${ipaUrl}/ipa/session/json`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", referer: `${ipaUrl}/ipa/ui/`, cookie },
    body: JSON.stringify({ method, params: [args, options], id: 0 }),
    signal: AbortSignal.timeout(20000),
    redirect: "manual",
  }, "JSON-RPC");
  if (rpc.status >= 300 && rpc.status < 400) throw new Error(`FreeIPA перенаправляет JSON-RPC endpoint (HTTP ${rpc.status})`);
  const payload = await rpc.json().catch(() => { throw new Error(`JSON-RPC FreeIPA вернул не-JSON ответ (HTTP ${rpc.status})`); }) as { result?: { result?: Array<Record<string, unknown>> }; error?: { message?: string } | null };
  if (!rpc.ok || payload.error) throw new Error(payload.error?.message ?? `${method} failed`);
  return payload.result?.result ?? [];
}

const allowedOperations = new Set(["user_add", "user_mod", "user_password", "user_enable", "user_disable", "user_del", "group_add", "group_del", "group_add_member", "group_remove_member"]);

type FreeIpaOperation = "user_add" | "user_mod" | "user_password" | "user_enable" | "user_disable" | "user_del" | "group_add" | "group_del" | "group_add_member" | "group_remove_member";

function directText(source: Record<string, unknown>, keys: string[], maxLength = 255): string {
  for (const key of keys) {
    if (typeof source[key] !== "string") continue;
    const value = source[key].trim();
    if (value && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  }
  return "";
}

function directId(source: Record<string, unknown>, keys: string[], label: string): string {
  const value = directText(source, keys);
  if (!value || !/^[A-Za-z0-9_.@$-]+$/.test(value)) throw new Error(`Некорректное поле: ${label}`);
  return value;
}

function directSecret(source: Record<string, unknown>, keys: string[], maxLength = 1024): string {
  for (const key of keys) {
    if (typeof source[key] !== "string") continue;
    const value = source[key];
    if (value && value.length <= maxLength && !value.includes("\u0000")) return value;
  }
  return "";
}

function freeIpaDirectCall(operation: FreeIpaOperation, body: Record<string, unknown>): { method: string; args: unknown[]; options: Record<string, unknown>; title: string; values: Record<string, unknown> } {
  const username = () => directId(body, ["username", "uid", "user"], "логин");
  const group = () => directId(body, ["group", "groupname", "cn"], "группа");
  if (operation === "user_add") {
    const uid = username();
    const givenname = directText(body, ["firstName", "givenname"]);
    const sn = directText(body, ["lastName", "sn"]);
    if (!givenname || !sn) throw new Error("Имя и фамилия обязательны");
    const mail = directText(body, ["email", "mail"]);
    const password = directSecret(body, ["password", "userpassword"]);
    const options: Record<string, unknown> = { givenname, sn };
    if (mail) options.mail = mail;
    if (password) options.userpassword = password;
    return { method: "user_add", args: [uid], options, title: "Создание пользователя FreeIPA", values: { uid, mail } };
  }
  if (operation === "user_mod") {
    const uid = username();
    const options: Record<string, unknown> = {};
    const givenname = directText(body, ["firstName", "givenname"]);
    const sn = directText(body, ["lastName", "sn"]);
    const mail = directText(body, ["email", "mail"]);
    if (givenname) options.givenname = givenname;
    if (sn) options.sn = sn;
    if (mail) options.mail = mail;
    if (!Object.keys(options).length) throw new Error("Укажите хотя бы одно изменяемое поле");
    return { method: "user_mod", args: [uid], options, title: "Редактирование пользователя FreeIPA", values: { uid, mail } };
  }
  if (operation === "user_password") {
    const uid = username();
    const password = directSecret(body, ["password", "userpassword"]);
    if (password.length < 8) throw new Error("Новый пароль должен содержать не менее 8 символов");
    return { method: "user_mod", args: [uid], options: { userpassword: password }, title: "Сброс пароля пользователя FreeIPA", values: { uid } };
  }
  if (operation === "user_enable" || operation === "user_disable" || operation === "user_del") {
    const uid = username();
    const titles = { user_enable: "Включение пользователя FreeIPA", user_disable: "Отключение пользователя FreeIPA", user_del: "Удаление пользователя FreeIPA" };
    return { method: operation, args: [uid], options: {}, title: titles[operation], values: { uid } };
  }
  if (operation === "group_add") {
    const cn = group();
    const description = directText(body, ["description"], 1024);
    return { method: "group_add", args: [cn], options: description ? { description } : {}, title: "Создание группы FreeIPA", values: { group: cn } };
  }
  if (operation === "group_del") {
    const cn = group();
    return { method: "group_del", args: [cn], options: {}, title: "Удаление группы FreeIPA", values: { group: cn } };
  }
  const cn = group();
  const uid = username();
  return {
    method: operation,
    args: [cn],
    options: { user: [uid] },
    title: operation === "group_add_member" ? "Добавление участника FreeIPA" : "Удаление участника FreeIPA",
    values: { group: cn, uid },
  };
}

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
    return { key, title, operation, kind, eventId, schemaVersion: String(source.schemaVersion ?? "").slice(0, 64) || undefined, enabled: source.enabled !== false, fields, targets };
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
  return { key: route.key, title: route.title, operation: route.operation, kind: route.kind, eventId: route.eventId, schemaVersion: route.schemaVersion ?? null, enabled: route.enabled !== false, targets: route.targets ?? [], fields: route.fields ?? [] };
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
  const raw = source.visibleWhen ?? source.visible_when ?? source.show_when ?? source.condition ?? source.depends_on;
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
  const raw = source.optionsSource ?? source.options_source ?? source.data_source;
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
  else if (xyType === "email" || variant === "email") type = "email";
  else if (xyType === "url" || variant === "url") type = "url";
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
    description: String(source.description ?? source.help ?? source.hint ?? source.caption ?? ""),
    placeholder: String(source.placeholder ?? ""),
    pattern: (() => { const value = String(source.pattern ?? source.regex ?? "").trim(); return value ? value.slice(0, 240) : undefined; })(),
    readOnly: source.locked === true || source.readOnly === true || source.read_only === true,
    min: typeof source.min === "number" ? source.min : undefined,
    max: typeof source.max === "number" ? source.max : undefined,
    section: String(source.section ?? source.group ?? source.fieldset ?? "").trim().slice(0, 120) || undefined,
    groupPath: (() => {
      const rawPath = source.groupPath ?? source.group_path ?? source.section_path ?? source.path;
      const values = Array.isArray(rawPath) ? rawPath.map(String) : typeof rawPath === "string" ? rawPath.split(/\s*(?:\/|>)\s*/) : [];
      const path = values.map((value) => value.trim().slice(0, 120)).filter(Boolean).slice(0, 8);
      return path.length ? path : undefined;
    })(),
    order: typeof source.order === "number" ? source.order : typeof source.position === "number" ? source.position : undefined,
    visibleWhen: fieldCondition(source),
    optionsSource: fieldOptionsSource(source),
  };
}

function normalizeXyFields(rawFields: unknown[], parentPath: string[] = []): RouteField[] {
  const result: RouteField[] = [];
  for (const raw of rawFields) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const source = raw as Record<string, unknown>;
    const type = String(source.type ?? "").toLowerCase();
    const children = [source.children, source.fields, source.items].find(Array.isArray) as unknown[] | undefined;
    if (["group", "section", "fieldset"].includes(type) && children) {
      const title = String(source.title ?? source.label ?? source.name ?? "Группа").trim().slice(0, 120);
      result.push(...normalizeXyFields(children, title ? [...parentPath, title] : parentPath));
      continue;
    }
    const field = normalizeXyField(source);
    if (!field) continue;
    if (!field.groupPath?.length && parentPath.length) field.groupPath = parentPath;
    result.push(field);
  }
  return result;
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

function schemaFingerprint(event: Pick<CatalogEvent, "operation" | "kind" | "fields" | "targets" | "dangerous">): string {
  const value = JSON.stringify({ operation: event.operation, kind: event.kind, fields: event.fields, targets: event.targets, dangerous: event.dangerous });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function inferCatalogOperation(event: Record<string, unknown>): string | undefined {
  const hints: string[] = [String(event.id ?? ""), String(event.title ?? ""), String(event.name ?? ""), String(event.operation ?? "")];
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 100)) visit(item, depth + 1);
      return;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (["operation", "action", "freeipa_tool", "command", "task"].includes(key.toLowerCase()) && (typeof nested === "string" || typeof nested === "number")) hints.push(String(nested));
      else if (["params", "workflow", "nodes", "data"].includes(key.toLowerCase())) visit(nested, depth + 1);
    }
  };
  visit(event);
  const compact = hints.join(" ").toLowerCase().replace(/[^a-zа-яё0-9]+/g, "");
  const mappings: Array<[string, string[]]> = [
    ["group_add_member", ["addusertogroup", "addusertogroups", "groupaddmember", "добавитьпользователявгруппу"]],
    ["group_remove_member", ["removeuserfromgroup", "removeuserfromgroups", "groupremovemember", "удалитьпользователяизгруппы"]],
    ["user_disable", ["disableuser", "userdisable", "отключитьпользователя", "заблокироватьпользователя"]],
    ["user_enable", ["enableuser", "userenable", "включитьпользователя", "разблокироватьпользователя"]],
    ["user_del", ["deleteuser", "deluser", "userdel", "удалитьпользователя"]],
    ["user_mod", ["modifyuser", "updateuser", "edituser", "usermod", "редактироватьпользователя", "изменитьпользователя"]],
    ["user_add", ["createuser", "adduser", "useradd", "создатьпользователя", "добавитьпользователя"]],
    ["group_del", ["deletegroup", "delgroup", "groupdel", "удалитьгруппу"]],
    ["group_add", ["creategroup", "addgroup", "groupadd", "создатьгруппу", "добавитьгруппу"]],
  ];
  return mappings.find(([, aliases]) => aliases.some((alias) => compact.includes(alias)))?.[0];
}

function catalogItem(event: Record<string, unknown>): CatalogEvent {
  const workflow = event.workflow && typeof event.workflow === "object" ? event.workflow as Record<string, unknown> : null;
  const kind = String(event.type ?? event.kind ?? "").toLowerCase() === "workflow" || Boolean(workflow) ? "workflow" : "event";
  const rawFields = [event.user_fields, event.fields, event.params, workflow?.user_fields, workflow?.fields].find(Array.isArray) as unknown[] | undefined;
  const id = String(event.id ?? event.event_id ?? workflow?.id ?? "");
  const item: CatalogEvent = {
    id,
    title: String(event.title ?? event.name ?? workflow?.title ?? (id || "Untitled")),
    description: String(event.description ?? event.help ?? event.notes ?? workflow?.description ?? ""),
    operation: inferCatalogOperation(event),
    kind,
    enabled: event.enabled !== false,
    category: String(event.category ?? "general"),
    plugin: kind === "workflow" ? null : String(event.plugin ?? ""),
    fields: normalizeXyFields(rawFields ?? []),
    targets: targetValues(event.targets ?? event.target_options),
    dangerous: Boolean(event.dangerous ?? event.requires_confirmation),
  };
  item.schemaVersion = schemaFingerprint(item);
  return item;
}

function demoCatalog(env: Env): CatalogEvent[] {
  const routeEvents = automationRoutes(env).map((route) => ({ id: route.eventId, title: route.title, description: "Маршрут администрирования FreeIPA", operation: route.operation, kind: route.kind, enabled: route.enabled !== false, category: "FreeIPA", plugin: route.kind === "workflow" ? null : "freeipa", fields: route.fields ?? [], targets: route.targets ?? [], dangerous: false }));
  const events: CatalogEvent[] = [...routeEvents, { id: "database-backup", title: "Резервное копирование базы данных", description: "Создание и проверка резервной копии выбранной БД", kind: "workflow", enabled: true, category: "Databases", plugin: null, targets: ["db-prod-01", "db-stage-01"], dangerous: false, fields: [
    { key: "database", label: "База данных", type: "string", required: true, target: "workflowData", placeholder: "billing" },
    { key: "backupType", label: "Тип копии", type: "select", required: true, target: "workflowData", options: ["full", "incremental"], default: "full" },
    { key: "retentionDays", label: "Хранить, дней", type: "number", required: true, target: "workflowData", default: 14, min: 1, max: 365 },
    { key: "verify", label: "Проверить копию после создания", type: "boolean", target: "workflowData", default: true },
  ] }];
  return events.map((event) => ({ ...event, schemaVersion: schemaFingerprint(event) }));
}

async function loadCatalog(env: Env, xyopsUrl: string | null): Promise<{ mode: "demo" | "live" | "unconfigured"; events: CatalogEvent[] }> {
  if (boolValue(env.DEMO_MODE)) return { mode: "demo", events: demoCatalog(env) };
  if (!xyopsUrl || !env.XYOPS_API_KEY) return { mode: "unconfigured", events: [] };
  let response: Response;
  try {
    response = await fetch(`${xyopsUrl}/api/app/get_events/v1`, { method: "GET", headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "RequestError";
    if (name === "TimeoutError" || name === "AbortError") throw new Error("Таймаут подключения к XYOps из среды портала");
    throw new Error("XYOps недоступен из среды портала: проверьте адрес, DNS и маршрут Docker");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`XYOps get_events вернул HTTP ${response.status}`);
  if (!xyopsPayloadSucceeded(payload)) {
    const code = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).code : "unknown";
    throw new Error(`XYOps get_events вернул код API ${String(code).slice(0, 24)}`);
  }
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
    await saveCatalogHistory(env, events, changes, syncedAt);
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
  stages?: RunStage[];
}): OperationRun {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), jobId: input.jobId || `LOCAL-${now}`, eventId: input.eventId, title: input.title,
    kind: input.kind, mode: input.mode, status: input.status, actor: requestActor(input.request),
    subject: runSubject(input.values ?? {}, input.targets), error: (input.error ?? "").slice(0, 500), stages: input.stages ?? [],
    startedAt: now, updatedAt: now, completedAt: input.status === "success" || input.status === "failed" ? now : null,
  };
}

async function handleIntegrationApi(request: Request, baseEnv: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/integrations/health") return json({ ok: true });
  if (url.pathname === "/api/integrations/settings" || url.pathname === "/api/integrations/settings/test") return handleSettingsApi(request, baseEnv, url);
  const env = await effectiveEnv(baseEnv);
  const ipaUrl = cleanBaseUrl(env.IPA_URL);
  const xyopsUrl = cleanBaseUrl(env.XYOPS_URL);

  if (request.method === "GET" && url.pathname === "/api/integrations/status") {
    const demoMode = boolValue(env.DEMO_MODE);
    const ipaConfigured = Boolean(ipaUrl && env.IPA_USERNAME && env.IPA_PASSWORD);
    const xyopsConfigured = Boolean(xyopsUrl && env.XYOPS_API_KEY);
    const [ipaProbe, xyopsReachable] = await Promise.all([
      !demoMode && ipaConfigured && ipaUrl
        ? ipaRpc(env, ipaUrl, "user_find", [""], { sizelimit: 1 }).then(() => ({ reachable: true, error: null })).catch((error) => ({ reachable: false, error: error instanceof Error ? error.message : "FreeIPA connection failed" }))
        : Promise.resolve({ reachable: false, error: null }),
      !demoMode && xyopsConfigured ? reachable(xyopsUrl) : false,
    ]);
    return json({ mode: demoMode ? "demo" : ipaConfigured || xyopsConfigured ? "live" : "unconfigured", viewer: requestActor(request), persistence: { available: Boolean(baseEnv.DB), configured: Boolean(baseEnv.CONFIG_ENCRYPTION_KEY) }, freeipa: { configured: ipaConfigured, reachable: ipaProbe.reachable, error: ipaProbe.error }, xyops: { configured: xyopsConfigured, reachable: xyopsReachable } });
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

  if (request.method === "GET" && url.pathname === "/api/integrations/catalog/history") {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    try { return json({ persistenceAvailable: Boolean(baseEnv.DB), history: await listCatalogHistory(baseEnv, Number.isFinite(limit) ? limit : 20) }); }
    catch { return json({ persistenceAvailable: Boolean(baseEnv.DB), history: [] }); }
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
      const run = operationRun({ request, eventId: event.id, title: event.title, kind: event.kind, mode: "live", jobId, status: reported === "unknown" ? "queued" : reported, values, targets: requestedTargets, stages: extractJobStages(result) });
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
        firstName: String(firstValue(entry.givenname) ?? ""),
        lastName: String(firstValue(entry.sn) ?? ""),
        email: String(firstValue(entry.mail) ?? ""),
        active: !boolValue(entry.nsaccountlock),
        groups: Array.isArray(entry.memberof_group) ? entry.memberof_group.length : 0,
        groupNames: (Array.isArray(entry.memberof_group) ? entry.memberof_group : entry.memberof_group ? [entry.memberof_group] : []).map(String).filter(Boolean),
      })).filter((user) => user.uid);
      return json({ mode: "live", users });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "FreeIPA request failed" }, 502);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/groups") {
    if (boolValue(env.DEMO_MODE)) return json({ mode: "demo", groups: [] });
    if (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD) return json({ mode: "unconfigured", groups: [] });
    let groupFindError: unknown = null;
    try {
      const list = await ipaRpc(env, ipaUrl, "group_find", [""], { all: true, sizelimit: 0 });
      const groups = list.map((entry) => ({
        name: String(firstValue(entry.cn) ?? ""),
        description: String(firstValue(entry.description) ?? "Без описания"),
        members: Array.isArray(entry.member_user) ? entry.member_user.length : 0,
        memberUids: (Array.isArray(entry.member_user) ? entry.member_user : entry.member_user ? [entry.member_user] : []).map(String).filter(Boolean),
        type: firstValue(entry.gidnumber) ? "POSIX" : "Non-POSIX",
      })).filter((group) => group.name);
      if (groups.length) return json({ mode: "live", source: "group_find", groups });
    } catch (error) {
      groupFindError = error;
    }
    try {
      const users = await ipaRpc(env, ipaUrl, "user_find", [""], { all: true, sizelimit: 0 });
      const membersByGroup = new Map<string, Set<string>>();
      for (const entry of users) {
        const uid = String(firstValue(entry.uid) ?? "");
        const memberships = Array.isArray(entry.memberof_group) ? entry.memberof_group : entry.memberof_group ? [entry.memberof_group] : [];
        for (const value of new Set(memberships.map(String).filter(Boolean))) {
          const members = membersByGroup.get(value) ?? new Set<string>();
          if (uid) members.add(uid);
          membersByGroup.set(value, members);
        }
      }
      const groups = Array.from(membersByGroup, ([name, memberUids]) => ({ name, description: "Получено из членства пользователей", members: memberUids.size, memberUids: Array.from(memberUids).sort(), type: "Directory" }))
        .sort((left, right) => left.name.localeCompare(right.name));
      return json({ mode: "live", source: "user_membership", degraded: true, groups });
    } catch {
      return json({ error: groupFindError instanceof Error ? groupFindError.message : "FreeIPA group_find and membership fallback failed" }, 502);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/integrations/freeipa/actions") {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    if (typeof body.operation !== "string" || !allowedOperations.has(body.operation)) return json({ error: "Unsupported operation" }, 400);
    if (!boolValue(env.DEMO_MODE) && (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD)) return json({ error: "FreeIPA is not configured" }, 503);
    let call: ReturnType<typeof freeIpaDirectCall>;
    try {
      call = freeIpaDirectCall(body.operation as FreeIpaOperation, body);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Некорректные параметры FreeIPA" }, 400);
    }
    if (boolValue(env.DEMO_MODE)) {
      const run = operationRun({ request, eventId: `freeipa:${body.operation}`, title: call.title, kind: "event", mode: "demo", jobId: `IPA-DEMO-${Date.now()}`, status: "success", values: call.values });
      await saveOperationRun(baseEnv, run);
      return json({ mode: "demo", direct: true, ok: true, runId: run.id, status: run.status });
    }
    try {
      await ipaRpc(env, ipaUrl as string, call.method, call.args, call.options);
      const run = operationRun({ request, eventId: `freeipa:${body.operation}`, title: call.title, kind: "event", mode: "live", jobId: `IPA-${Date.now()}`, status: "success", values: call.values });
      await saveOperationRun(baseEnv, run);
      return json({ mode: "live", direct: true, ok: true, runId: run.id, status: run.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "FreeIPA request failed";
      const run = operationRun({ request, eventId: `freeipa:${body.operation}`, title: call.title, kind: "event", mode: "live", jobId: "", status: "failed", values: call.values, error: message });
      await saveOperationRun(baseEnv, run);
      return json({ error: message, runId: run.id }, 502);
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
      const run = operationRun({ request, eventId: route.eventId, title: route.title, kind: route.kind, mode: "live", jobId, status: response.ok ? reported === "unknown" ? "queued" : reported : "failed", values: body, targets: route.targets ?? [], error: response.ok ? "" : "XYOps rejected run_event", stages: extractJobStages(result) });
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
