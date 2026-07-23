import runtime from "./index";

type BaseEnv = NonNullable<Parameters<typeof runtime.fetch>[1]>;
type RuntimeContext = Parameters<typeof runtime.fetch>[2];
type IdentityMode = "anonymous" | "workspace" | "proxy" | "static";
type PortalRole = "viewer" | "operator" | "admin";
type CatalogSyncStatus = "running" | "success" | "failed" | "skipped";
type ScheduledController = { cron?: string; scheduledTime?: number };

type SecureEnv = BaseEnv & {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_IDENTITY_HEADER?: string;
  PORTAL_IDENTITY_NAME_HEADER?: string;
  PORTAL_PROXY_SECRET_HEADER?: string;
  PORTAL_PROXY_SHARED_SECRET?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_STATIC_GROUPS?: string;
  PORTAL_GROUPS_HEADER?: string;
  PORTAL_GROUPS_JSON?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  ADMIN_TOKEN?: string;
  XYOPS_CATALOG_SYNC_ENABLED?: string;
  XYOPS_CATALOG_SYNC_LOCK_TTL_SECONDS?: string;
};

type CatalogSyncRun = {
  id: string;
  trigger: string;
  status: CatalogSyncStatus;
  startedAt: number;
  completedAt: number | null;
  processCount: number;
  changeCount: number;
  error: string;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const createCatalogSyncLockTable = `CREATE TABLE IF NOT EXISTS xyops_catalog_sync_lock (
  id TEXT PRIMARY KEY NOT NULL,
  acquired_at INTEGER NOT NULL
)`;
const createCatalogSyncRunsTable = `CREATE TABLE IF NOT EXISTS xyops_catalog_sync_runs (
  id TEXT PRIMARY KEY NOT NULL,
  trigger_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  process_count INTEGER NOT NULL DEFAULT 0,
  change_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
)`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function identityMode(value: unknown): IdentityMode {
  return value === "workspace" || value === "proxy" || value === "static" ? value : "anonymous";
}

function safeHeaderName(value: unknown, fallback: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,126}$/.test(normalized) ? normalized : fallback;
}

function normalizedIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized.length > 160 || !normalized.includes("@") || /[\s,\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function normalizedName(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function normalizedGroups(value: string | null | undefined): string[] {
  return Array.from(new Set(String(value ?? "").split(/[;,]/).map((item) => item.trim().toLowerCase()).filter((item) => item && item.length <= 120 && !/[\r\n]/.test(item)))).slice(0, 100);
}

function mappedGroups(identity: string, value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const entries = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, groups]) => [key.trim().toLowerCase(), groups]));
    const selected = entries[identity] ?? entries["*"];
    return Array.isArray(selected) ? normalizedGroups(selected.map(String).join(",")) : normalizedGroups(String(selected ?? ""));
  } catch {
    return [];
  }
}

async function secretsMatch(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(providedHash);
  const wanted = new Uint8Array(expectedHash);
  let difference = actual.length ^ wanted.length;
  for (let index = 0; index < wanted.length; index += 1) difference |= wanted[index] ^ (actual[index] ?? 0);
  return difference === 0;
}

function anonymousRbac(value: string | undefined): string {
  if (!value) return "{}";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "{}";
    const assignments = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([key]) => !["*", "portal-user", "anonymous"].includes(key.trim().toLowerCase())));
    return JSON.stringify(assignments);
  } catch {
    return "{}";
  }
}

function portalRole(value: unknown): PortalRole | null {
  return value === "viewer" || value === "operator" || value === "admin" ? value : null;
}

function requestRole(request: Request, env: SecureEnv): PortalRole {
  const identity = (request.headers.get("oai-authenticated-user-email") ?? "portal-user").trim().toLowerCase();
  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE ?? "").trim().toLowerCase()) ?? "viewer";
  if (!env.PORTAL_RBAC_JSON) return role;
  try {
    const parsed = JSON.parse(env.PORTAL_RBAC_JSON) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return role;
    const values = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => [key.trim().toLowerCase(), value]));
    role = portalRole(values[identity]) ?? portalRole(values["*"]) ?? role;
  } catch {}
  return role;
}

function requestActor(request: Request): string {
  return (request.headers.get("oai-authenticated-user-email") ?? "portal-user").slice(0, 160);
}

async function secureContext(request: Request, sourceEnv: SecureEnv): Promise<{ request: Request; env: SecureEnv }> {
  const mode = identityMode(sourceEnv.PORTAL_IDENTITY_MODE);
  const headers = new Headers(request.headers);
  const workspaceEmail = headers.get("oai-authenticated-user-email");
  const workspaceName = headers.get("oai-authenticated-user-full-name");
  const workspaceNameEncoding = headers.get("oai-authenticated-user-full-name-encoding");

  headers.delete("oai-authenticated-user-email");
  headers.delete("oai-authenticated-user-full-name");
  headers.delete("oai-authenticated-user-full-name-encoding");
  headers.delete("oai-authenticated-user-groups");

  let identity: string | null = null;
  let displayName: string | null = null;
  let groups: string[] = [];

  if (mode === "workspace") {
    identity = normalizedIdentity(workspaceEmail);
    if (workspaceNameEncoding === "percent-encoded-utf-8" && workspaceName) {
      try { displayName = normalizedName(decodeURIComponent(workspaceName)); } catch {}
    }
  } else if (mode === "proxy") {
    const identityHeader = safeHeaderName(sourceEnv.PORTAL_IDENTITY_HEADER, "x-auth-request-email");
    const nameHeader = safeHeaderName(sourceEnv.PORTAL_IDENTITY_NAME_HEADER, "x-auth-request-user");
    const groupsHeader = safeHeaderName(sourceEnv.PORTAL_GROUPS_HEADER, "x-auth-request-groups");
    const secretHeader = safeHeaderName(sourceEnv.PORTAL_PROXY_SECRET_HEADER, "x-portal-proxy-secret");
    const trusted = await secretsMatch(headers.get(secretHeader), sourceEnv.PORTAL_PROXY_SHARED_SECRET);
    if (trusted) {
      identity = normalizedIdentity(headers.get(identityHeader));
      displayName = normalizedName(headers.get(nameHeader));
      groups = normalizedGroups(headers.get(groupsHeader));
    }
    headers.delete(identityHeader);
    headers.delete(nameHeader);
    headers.delete(groupsHeader);
    headers.delete(secretHeader);
  } else if (mode === "static") {
    identity = normalizedIdentity(sourceEnv.PORTAL_STATIC_IDENTITY);
    displayName = normalizedName(sourceEnv.PORTAL_STATIC_NAME);
    groups = normalizedGroups(sourceEnv.PORTAL_STATIC_GROUPS);
  }

  if (identity) {
    groups = Array.from(new Set([...groups, ...mappedGroups(identity, sourceEnv.PORTAL_GROUPS_JSON)])).slice(0, 100);
    headers.set("oai-authenticated-user-email", identity);
    if (groups.length) headers.set("oai-authenticated-user-groups", groups.join(","));
  }
  if (displayName) {
    headers.set("oai-authenticated-user-full-name", encodeURIComponent(displayName));
    headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  }

  const env: SecureEnv = {
    ...sourceEnv,
    PORTAL_DEFAULT_ROLE: String(sourceEnv.PORTAL_DEFAULT_ROLE ?? "").trim() || "viewer",
  };
  if (!identity) {
    env.PORTAL_DEFAULT_ROLE = "viewer";
    env.PORTAL_RBAC_JSON = anonymousRbac(sourceEnv.PORTAL_RBAC_JSON);
  }

  return { request: new Request(request, { headers }), env };
}

function catalogSyncEnabled(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !["false", "0", "no", "off", "disabled"].includes(normalized);
}

function catalogSyncLockTtlMs(env: SecureEnv): number {
  const seconds = Number(env.XYOPS_CATALOG_SYNC_LOCK_TTL_SECONDS ?? 900);
  return Math.max(60, Math.min(Number.isFinite(seconds) ? seconds : 900, 3600)) * 1000;
}

function syncError(error: unknown): string {
  return (error instanceof Error ? error.message : "XYOps catalog synchronization failed")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
}

async function ensureCatalogSyncTables(env: SecureEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createCatalogSyncLockTable).run();
  await env.DB.prepare(createCatalogSyncRunsTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS xyops_catalog_sync_runs_started_at_idx ON xyops_catalog_sync_runs(started_at DESC)").run();
}

async function acquireCatalogSyncLock(env: SecureEnv, acquiredAt: number): Promise<boolean> {
  if (!env.DB) return false;
  await ensureCatalogSyncTables(env);
  await env.DB.prepare("DELETE FROM xyops_catalog_sync_lock WHERE id = ? AND acquired_at < ?")
    .bind("catalog", acquiredAt - catalogSyncLockTtlMs(env)).run();
  const result = await env.DB.prepare("INSERT OR IGNORE INTO xyops_catalog_sync_lock (id, acquired_at) VALUES (?, ?)")
    .bind("catalog", acquiredAt).run() as unknown as { meta?: { changes?: number }; changes?: number };
  return Number(result.meta?.changes ?? result.changes ?? 0) > 0;
}

async function releaseCatalogSyncLock(env: SecureEnv, acquiredAt: number): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM xyops_catalog_sync_lock WHERE id = ? AND acquired_at = ?")
    .bind("catalog", acquiredAt).run();
}

async function saveCatalogSyncRun(env: SecureEnv, run: CatalogSyncRun): Promise<void> {
  if (!env.DB) return;
  await ensureCatalogSyncTables(env);
  await env.DB.prepare("INSERT INTO xyops_catalog_sync_runs (id, trigger_name, status, started_at, completed_at, process_count, change_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, process_count = excluded.process_count, change_count = excluded.change_count, error = excluded.error")
    .bind(run.id, run.trigger, run.status, run.startedAt, run.completedAt, run.processCount, run.changeCount, run.error || null).run();
  await env.DB.prepare("DELETE FROM xyops_catalog_sync_runs WHERE id NOT IN (SELECT id FROM xyops_catalog_sync_runs ORDER BY started_at DESC LIMIT 50)").run();
}

async function listCatalogSyncRuns(env: SecureEnv, limit = 20): Promise<CatalogSyncRun[]> {
  if (!env.DB) return [];
  await ensureCatalogSyncTables(env);
  const result = await env.DB.prepare("SELECT id, trigger_name, status, started_at, completed_at, process_count, change_count, error FROM xyops_catalog_sync_runs ORDER BY started_at DESC LIMIT ?")
    .bind(Math.max(1, Math.min(limit, 50))).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({
    id: String(row.id ?? ""),
    trigger: String(row.trigger_name ?? "scheduled"),
    status: ["running", "success", "failed", "skipped"].includes(String(row.status)) ? String(row.status) as CatalogSyncStatus : "failed",
    startedAt: Number(row.started_at ?? 0),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    processCount: Number(row.process_count ?? 0),
    changeCount: Number(row.change_count ?? 0),
    error: String(row.error ?? ""),
  })).filter((run) => run.id);
}

async function runCatalogSynchronization(env: SecureEnv, trigger: string, ctx: RuntimeContext): Promise<CatalogSyncRun> {
  const startedAt = Date.now();
  const run: CatalogSyncRun = {
    id: crypto.randomUUID(), trigger: trigger.slice(0, 160), status: "running", startedAt,
    completedAt: null, processCount: 0, changeCount: 0, error: "",
  };
  if (!env.DB) return { ...run, status: "skipped", completedAt: Date.now(), error: "Persistent database is unavailable" };
  const acquired = await acquireCatalogSyncLock(env, startedAt);
  if (!acquired) {
    const skipped = { ...run, status: "skipped" as const, completedAt: Date.now(), error: "Синхронизация каталога уже выполняется" };
    await saveCatalogSyncRun(env, skipped);
    return skipped;
  }
  await saveCatalogSyncRun(env, run);
  try {
    const response = await runtime.fetch(new Request("https://portal.internal/api/integrations/catalog", {
      headers: { accept: "application/json" },
    }), env, ctx);
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error ?? `XYOps catalog returned HTTP ${response.status}`));
    const mode = String(payload.mode ?? "unconfigured");
    const source = String(payload.source ?? "none");
    if (source === "cache" || payload.stale === true) throw new Error("XYOps catalog synchronization returned cached data");
    if (mode === "demo" || mode === "unconfigured") {
      run.status = "skipped";
      run.error = mode === "demo" ? "Плановая синхронизация отключена в демо-режиме" : "XYOps is not configured";
    } else if (source !== "xyops") {
      throw new Error("XYOps catalog synchronization did not return a live catalog");
    } else {
      run.status = "success";
      run.processCount = Array.isArray(payload.events) ? payload.events.length : 0;
      run.changeCount = Array.isArray(payload.changes) ? payload.changes.length : 0;
    }
  } catch (error) {
    run.status = "failed";
    run.error = syncError(error);
  } finally {
    run.completedAt = Date.now();
    await releaseCatalogSyncLock(env, startedAt);
    await saveCatalogSyncRun(env, run);
  }
  return run;
}

async function handleCatalogSyncApi(request: Request, env: SecureEnv, ctx: RuntimeContext): Promise<Response> {
  if (requestRole(request, env) !== "admin") return json({ error: "Недостаточно прав для управления синхронизацией каталога" }, 403);
  if (!env.ADMIN_TOKEN || !await secretsMatch(request.headers.get("x-admin-token"), env.ADMIN_TOKEN)) return json({ error: "Administrator authorization required" }, 401);
  if (request.method === "GET") {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    return json({ enabled: catalogSyncEnabled(env.XYOPS_CATALOG_SYNC_ENABLED), persistenceAvailable: Boolean(env.DB), runs: await listCatalogSyncRuns(env, Number.isFinite(limit) ? limit : 20) });
  }
  if (request.method === "POST") {
    if (!env.DB) return json({ error: "Persistent database is unavailable" }, 503);
    const run = await runCatalogSynchronization(env, `manual:${requestActor(request)}`, ctx);
    return json({ run }, run.status === "failed" ? 502 : 200);
  }
  return json({ error: "Method not allowed" }, 405);
}

const worker = {
  async fetch(request: Request, env: SecureEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as SecureEnv);
    const secured = await secureContext(request, sourceEnv);
    if (new URL(secured.request.url).pathname === "/api/integrations/catalog/sync") {
      return handleCatalogSyncApi(secured.request, secured.env, ctx);
    }
    return runtime.fetch(secured.request, secured.env, ctx);
  },

  async scheduled(controller: ScheduledController, env: SecureEnv | undefined, ctx: RuntimeContext): Promise<void> {
    const sourceEnv = env ?? (process.env as unknown as SecureEnv);
    if (!catalogSyncEnabled(sourceEnv.XYOPS_CATALOG_SYNC_ENABLED)) return;
    const cron = String(controller.cron ?? "scheduled").slice(0, 120);
    ctx.waitUntil(runCatalogSynchronization(sourceEnv, `cron:${cron}`, ctx));
  },
};

export default worker;
