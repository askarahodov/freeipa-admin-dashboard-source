/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import type { AutomationRoute, CatalogEvent, RouteField } from "../src/automation/automation-types";
import { fieldConditionMatches, normalizeFieldCondition } from "../src/automation/field-conditions";
import { saveRunReplay } from "../src/operations/run/run-replays";
import { catalogEventAllowed, readCatalogPolicySet, saveCatalogPolicySet } from "../src/operations/catalog/catalog-policies";
import { approvalExecutionMatches, approvalRequirement, cancelApproval, claimApprovalExecution, createApprovalRequest, decideApproval, finishApprovalExecution, listApprovals, readApprovalPolicySet, readExecutingApproval, saveApprovalPolicySet } from "../src/operations/approvals/approval-gates";
import { appendAuditEvent, auditCorrelationFor, auditErrorCode, createAuditContext, listAuditEvents, withAuditCorrelation, type AuditContext } from "../audit-log";
import { applyProcessPresentation, availableProcessPresentationLocales, presentationLocalePreferences, readProcessPresentationSet, resolveProcessPresentationLocale, saveProcessPresentationSet } from "../src/operations/presentation/process-presentation";
import { handleBackupExportRequest } from "./backup-export-entry";
import type { PortalPermission } from "../src/auth/portal-permissions";
import { freeIpaRpc as ipaRpc } from "./freeipa-rpc.ts";
import { decryptIntegrationSecrets as decryptSecrets, encryptIntegrationSecrets as encryptSecrets } from "./integration-settings-runtime.ts";
import { portalAccess, requestActor, requirePortalPermission } from "./portal-access-runtime.ts";
import { operationRun, saveOperationRun } from "./operation-run-runtime.ts";
import { extractJobStages, runStatus, xyopsPayloadSucceeded } from "./xyops-run-runtime.ts";

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
  XYOPS_RESULT_FILE_MAX_BYTES?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  ADMIN_TOKEN?: string;
  DEMO_MODE?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
  PORTAL_CATALOG_POLICIES_JSON?: string;
  PORTAL_APPROVAL_POLICIES_JSON?: string;
  PORTAL_PROCESS_METADATA_JSON?: string;
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

    if (url.pathname === "/api/admin/backups/export") {
      const denied = requirePortalPermission(request, runtimeEnv, "backup.export");
      if (denied) return denied;
      return handleBackupExportRequest(request, runtimeEnv, createAuditContext(portalAccess(request, runtimeEnv)));
    }

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

    if (request.method === "GET" && request.headers.get("accept")?.includes("text/html") && /^\/(?:automation(?:\/[^/]+)?|users|groups|operations|approvals|audit|settings)\/?$/.test(url.pathname)) {
      const appUrl = new URL(request.url);
      appUrl.pathname = "/";
      return handler.fetch(new Request(appUrl, request), env, ctx);
    }

    return handler.fetch(request, env, ctx);
  },
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

async function readCatalogSnapshot(env: Env): Promise<CatalogSnapshot | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT catalog_json, synced_at FROM xyops_catalog_snapshot WHERE id = ?").bind("current").first<{ catalog_json: string; synced_at: number }>();
  if (!row) return null;
  try {
    const events = JSON.parse(row.catalog_json) as CatalogEvent[];
    return Array.isArray(events) ? { events: events.filter((event) => event && typeof event.id === "string"), syncedAt: Number(row.synced_at) } : null;
  } catch { return null; }
}

async function saveCatalogSnapshot(env: Env, events: CatalogEvent[], syncedAt: number): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO xyops_catalog_snapshot (id, catalog_json, synced_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET catalog_json = excluded.catalog_json, synced_at = excluded.synced_at")
    .bind("current", JSON.stringify(events), syncedAt).run();
}

async function saveCatalogHistory(env: Env, events: CatalogEvent[], changes: CatalogChange[], syncedAt: number): Promise<void> {
  if (!env.DB || !changes.length) return;
  await env.DB.prepare("INSERT INTO xyops_catalog_history (id, synced_at, changes_json, catalog_json) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), syncedAt, JSON.stringify(changes), JSON.stringify(events)).run();
  await env.DB.prepare("DELETE FROM xyops_catalog_history WHERE id NOT IN (SELECT id FROM xyops_catalog_history ORDER BY synced_at DESC LIMIT 30)").run();
}

async function listCatalogHistory(env: Env, limit = 20): Promise<CatalogHistoryEntry[]> {
  if (!env.DB) return [];
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
  const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?").bind("main").first<{ config_json: string; encrypted_secrets: string; updated_at: number }>();
  if (!row) return null;
  const config = JSON.parse(row.config_json) as Partial<StoredConfig>;
  const secrets = await decryptSecrets(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
  return { config: { demoMode: config.demoMode === true, ipaUrl: String(config.ipaUrl ?? ""), ipaUsername: String(config.ipaUsername ?? ""), xyopsUrl: String(config.xyopsUrl ?? ""), routes: Array.isArray(config.routes) ? sanitizeRoutes(config.routes) : undefined }, secrets, updatedAt: Number(row.updated_at) };
}

async function saveStoredSettings(env: Env, settings: StoredSettings): Promise<void> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const encryptedSecrets = await encryptSecrets(settings.secrets, env.CONFIG_ENCRYPTION_KEY);
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

async function handleSettingsApi(request: Request, env: Env, url: URL, audit: AuditContext): Promise<Response> {
  const denied = requirePortalPermission(request, env, "settings.manage");
  if (denied) return denied;
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
      await appendAuditEvent(env, audit, { action: "settings.updated", resourceType: "portal_settings", resourceId: "main", outcome: "success", metadata: { demoMode: next.config.demoMode, freeipaUrlConfigured: Boolean(next.config.ipaUrl), freeipaUsernameConfigured: Boolean(next.config.ipaUsername), freeipaPasswordConfigured: Boolean(next.secrets.ipaPassword), xyopsUrlConfigured: Boolean(next.config.xyopsUrl), xyopsApiKeyConfigured: Boolean(next.secrets.xyopsApiKey) } }).catch(() => {});
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
      const latencyMs = Date.now() - started;
      await appendAuditEvent(env, audit, { action: "settings.connection_test", resourceType: "integration", resourceId: service, outcome: "success", metadata: { service, latencyMs } }).catch(() => {});
      return json({ ok: true, service, latencyMs });
    } catch (error) {
      await appendAuditEvent(env, audit, { action: "settings.connection_test", resourceType: "integration", resourceId: String(body.service ?? "unknown"), outcome: "failure", errorCode: auditErrorCode(error, "connection_test_failed") }).catch(() => {});
      return json({ error: error instanceof Error ? error.message : "Connection test failed" }, 502);
    }
  }
  return json({ error: "Not found" }, 404);
}

const allowedOperations = new Set(["user_add", "user_mod", "user_password", "user_enable", "user_disable", "user_del", "group_add", "group_del", "group_add_member", "group_remove_member"]);

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
  return normalizeFieldCondition(source.visibleWhen ?? source.visible_when ?? source.show_when ?? source.condition ?? source.depends_on);
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
  return fieldConditionMatches(field.visibleWhen, values);
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

type CatalogRunReplayGuard = {
  expectedSchemaVersion: string;
  dangerousConfirmed: boolean;
  sourceRunId: string;
  sourceJobId: string;
  previousStatus: string;
};

export async function handleCatalogRunRequest(
  request: Request,
  baseEnv: Env,
  url: URL,
  inheritedAudit?: AuditContext,
  replayGuard?: CatalogRunReplayGuard,
  resolvedRuntime?: { env: Env; xyopsUrl: string | null },
): Promise<Response> {
  const audit = inheritedAudit ?? createAuditContext(portalAccess(request, baseEnv));
  const env = resolvedRuntime?.env ?? await effectiveEnv(baseEnv);
  const xyopsUrl = resolvedRuntime?.xyopsUrl ?? cleanBaseUrl(env.XYOPS_URL);
  const denied = requirePortalPermission(request, baseEnv, "xyops.run");
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
  try {
    const catalog = await loadCatalog(env, xyopsUrl);
    if (catalog.mode === "unconfigured") return json({ error: "XYOps is not configured" }, 503);
    const event = catalog.events.find((item) => item.id === eventId && item.enabled);
    if (!event) return replayGuard
      ? json({ error: "Исходный процесс отсутствует или отключён" }, 409)
      : json({ error: "XYOps process not found or disabled" }, 404);
    const access = portalAccess(request, baseEnv);
    const policyState = await readCatalogPolicySet(baseEnv);
    if (!catalogEventAllowed(policyState.policy, access, event)) return replayGuard
      ? json({ error: "Процесс недоступен по политике каталога" }, 404)
      : json({ error: "XYOps process not found or disabled" }, 404);
    if (replayGuard?.expectedSchemaVersion && (!event.schemaVersion || event.schemaVersion !== replayGuard.expectedSchemaVersion)) {
      return json({ error: "Схема процесса изменилась. Откройте актуальную форму и проверьте параметры заново.", schemaChanged: true }, 409);
    }
    if (replayGuard && event.dangerous && !replayGuard.dangerousConfirmed) {
      return json({ error: "Для опасного процесса требуется повторное подтверждение", requiresConfirmation: true }, 409);
    }
    if (replayGuard) {
      await appendAuditEvent(baseEnv, audit, {
        action: "xyops.run.rerun_requested", resourceType: "xyops_run", resourceId: replayGuard.sourceRunId,
        eventId: event.id, schemaVersion: replayGuard.expectedSchemaVersion, runId: replayGuard.sourceRunId,
        jobId: replayGuard.sourceJobId, outcome: "pending", metadata: { previousStatus: replayGuard.previousStatus },
      }).catch(() => {});
    }
    const presentationState = await readProcessPresentationSet(baseEnv);
    const displayEvent = applyProcessPresentation([event], presentationState.metadata, presentationLocalePreferences(url.searchParams.get("locale"), request.headers.get("accept-language")))[0] ?? event;
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
    const approvalExecutionId = String(request.headers.get("x-portal-approved-execution") ?? "").slice(0, 160);
    if (approvalExecutionId) {
      const executing = await readExecutingApproval(baseEnv, approvalExecutionId, access);
      if (!executing || !await approvalExecutionMatches(executing.spec, event, values, requestedTargets)) return json({ error: "Недействительное или использованное согласование" }, 409);
    } else {
      const approvalPolicy = await readApprovalPolicySet(baseEnv);
      const requirement = approvalRequirement(approvalPolicy.policy, access, event);
      if (requirement) {
        const approval = await createApprovalRequest(baseEnv, displayEvent, access, values, requestedTargets, requirement, typeof body.replayOf === "string" ? body.replayOf : "");
        await appendAuditEvent(baseEnv, audit, { action: "approval.requested", resourceType: "approval", resourceId: approval.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approval.id, outcome: "pending", metadata: { category: event.category, kind: event.kind, targets: requestedTargets, fieldKeys: event.fields.filter((field) => fieldVisible(field, values)).map((field) => field.key), requiredApprovals: requirement.requiredApprovals, ruleId: requirement.ruleId, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});
        return json({ approvalRequired: true, approvalId: approval.id, status: approval.status, approval }, 202);
      }
    }
    if (catalog.mode === "demo" || !xyopsUrl || !env.XYOPS_API_KEY) {
      const run = operationRun({ request, eventId: event.id, title: displayEvent.title, kind: event.kind, mode: "demo", jobId: `DEMO-${Date.now()}`, status: "success", values, targets: requestedTargets });
      await saveOperationRun(baseEnv, run);
      await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");
      await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approvalExecutionId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "demo", kind: event.kind, targets: requestedTargets, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});
      return json({ mode: "demo", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: displayEvent.title, kind: event.kind } }, 202);
    }
    const response = await fetch(`${xyopsUrl}/api/app/run_event/v1`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY }, body: JSON.stringify(launchPayload), signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    const resultData = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
    const jobId = String(result.job_id ?? result.jobId ?? result.id ?? resultData.job_id ?? "");
    if (!response.ok) {
      const retryAfter = String(response.headers.get("retry-after") ?? "").replace(/[^0-9A-Za-z, .:-]/g, "").slice(0, 120);
      const portalStatus = response.status === 409 || response.status === 429 ? response.status : 502;
      const message = response.status === 429 ? "XYOps ограничил частоту запусков" : response.status === 409 ? "XYOps не разрешил параллельный запуск" : "XYOps rejected run_event";
      const run = operationRun({ request, eventId: event.id, title: displayEvent.title, kind: event.kind, mode: "live", jobId, status: "failed", values, targets: requestedTargets, error: message });
      await saveOperationRun(baseEnv, run);
      await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");
      await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approvalExecutionId, runId: run.id, jobId, outcome: "failure", errorCode: response.status === 429 ? "xyops_rate_limited" : response.status === 409 ? "xyops_concurrency_conflict" : "xyops_run_event_rejected", metadata: { httpStatus: response.status, retryAfter, kind: event.kind, targets: requestedTargets } }).catch(() => {});
      return json({ error: message, runId: run.id, xyopsStatus: response.status, retryAfter: retryAfter || null }, portalStatus);
    }
    const reported = runStatus(result.status ?? result.state ?? resultData.status ?? resultData.state);
    const run = operationRun({ request, eventId: event.id, title: displayEvent.title, kind: event.kind, mode: "live", jobId, status: reported === "unknown" ? "queued" : reported, values, targets: requestedTargets, stages: extractJobStages(result) });
    await saveOperationRun(baseEnv, run);
    await saveRunReplay(baseEnv, run.id, event, values, requestedTargets, typeof body.replayOf === "string" ? body.replayOf.slice(0, 160) : "");
    await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: event.id, schemaVersion: event.schemaVersion, approvalId: approvalExecutionId, runId: run.id, jobId: run.jobId, outcome: "success", metadata: { mode: "live", initialStatus: run.status, kind: event.kind, targets: requestedTargets, replayOf: typeof body.replayOf === "string" ? body.replayOf : "" } }).catch(() => {});
    return json({ mode: "live", queued: true, runId: run.id, jobId: run.jobId, status: run.status, process: { id: event.id, title: displayEvent.title, kind: event.kind } }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "XYOps request failed";
    const run = operationRun({ request, eventId: eventId || "unknown", title: eventId || "XYOps process", kind: "event", mode: "live", jobId: "", status: "failed", values, error: message });
    await saveOperationRun(baseEnv, run);
    await appendAuditEvent(baseEnv, audit, { action: "xyops.run", resourceType: "xyops_run", resourceId: run.id, eventId: eventId || "unknown", runId: run.id, outcome: "unknown", errorCode: auditErrorCode(error, "xyops_request_failed"), metadata: { fieldKeys: Object.keys(values).filter((key) => !/pass|secret|token|key/i.test(key)) } }).catch(() => {});
    return json({ error: message, runId: run.id }, 502);
  }
}

async function handleIntegrationApi(request: Request, baseEnv: Env, url: URL, inheritedAudit?: AuditContext): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/integrations/health") return json({ ok: true });
  const audit = inheritedAudit ?? createAuditContext(portalAccess(request, baseEnv));
  if (url.pathname === "/api/integrations/settings" || url.pathname === "/api/integrations/settings/test") return handleSettingsApi(request, baseEnv, url, audit);
  const env = await effectiveEnv(baseEnv);
  const ipaUrl = cleanBaseUrl(env.IPA_URL);
  const xyopsUrl = cleanBaseUrl(env.XYOPS_URL);

  if (url.pathname === "/api/integrations/audit") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const numberParam = (name: string) => { const value = Number(url.searchParams.get(name) ?? ""); return Number.isFinite(value) ? value : undefined; };
    try {
      return json(await listAuditEvents(baseEnv, {
        limit: numberParam("limit"), actor: url.searchParams.get("actor") ?? undefined, action: url.searchParams.get("action") ?? undefined,
        outcome: url.searchParams.get("outcome") ?? undefined, eventId: url.searchParams.get("eventId") ?? undefined,
        approvalId: url.searchParams.get("approvalId") ?? undefined, runId: url.searchParams.get("runId") ?? undefined,
        correlationId: url.searchParams.get("correlationId") ?? undefined, dateFrom: numberParam("dateFrom"), dateTo: numberParam("dateTo"),
      }));
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load audit log" }, 503); }
  }

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
    const access = portalAccess(request, baseEnv);
    return json({ mode: demoMode ? "demo" : ipaConfigured || xyopsConfigured ? "live" : "unconfigured", viewer: requestActor(request), access: { identity: access.identity, role: access.role, permissions: access.permissions }, persistence: { available: Boolean(baseEnv.DB), configured: Boolean(baseEnv.CONFIG_ENCRYPTION_KEY) }, freeipa: { configured: ipaConfigured, reachable: ipaProbe.reachable, error: ipaProbe.error }, xyops: { configured: xyopsConfigured, reachable: xyopsReachable } });
  }

  if (url.pathname === "/api/integrations/catalog/presentation") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!baseEnv.ADMIN_TOKEN || !await adminAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try {
        const state = await readProcessPresentationSet(baseEnv);
        return json({ ...state, availableLocales: availableProcessPresentationLocales(state.metadata), persistenceAvailable: Boolean(baseEnv.DB) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot load process presentation metadata" }, 503);
      }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveProcessPresentationSet(baseEnv, body.metadata);
        const processIds = Object.keys(saved.metadata.processes);
        const availableLocales = availableProcessPresentationLocales(saved.metadata);
        await appendAuditEvent(baseEnv, audit, { action: "catalog.presentation.updated", resourceType: "process_presentation", resourceId: "current", outcome: "success", metadata: { version: saved.metadata.version, processCount: processIds.length, processIds: processIds.slice(0, 100), defaultLocale: saved.metadata.defaultLocale ?? "", localeCount: availableLocales.length } }).catch(() => {});
        return json({ ...saved, availableLocales, persistenceAvailable: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot save process presentation metadata" }, 400);
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/integrations/catalog/policies") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!baseEnv.ADMIN_TOKEN || !await adminAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try {
        const state = await readCatalogPolicySet(baseEnv);
        return json({ ...state, persistenceAvailable: Boolean(baseEnv.DB) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot load catalog policies" }, 503);
      }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveCatalogPolicySet(baseEnv, body.policy);
        await appendAuditEvent(baseEnv, audit, { action: "catalog.policy.updated", resourceType: "policy", resourceId: "catalog_visibility", outcome: "success", metadata: { version: saved.policy.version, defaultEffect: saved.policy.defaultEffect, adminBypass: saved.policy.adminBypass, ruleCount: saved.policy.rules.length } }).catch(() => {});
        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot save catalog policies" }, 400);
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/integrations/approval/policies") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!baseEnv.ADMIN_TOKEN || !await adminAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try { const state = await readApprovalPolicySet(baseEnv); return json({ ...state, persistenceAvailable: Boolean(baseEnv.DB) }); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load approval policies" }, 503); }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveApprovalPolicySet(baseEnv, body.policy);
        await appendAuditEvent(baseEnv, audit, { action: "approval.policy.updated", resourceType: "policy", resourceId: "xyops_approval", outcome: "success", metadata: { version: saved.policy.version, dangerousDefaultEnabled: Boolean(saved.policy.dangerousDefaults), ruleCount: saved.policy.rules.length } }).catch(() => {});
        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });
      } catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot save approval policies" }, 400); }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/approvals") {
    const denied = requirePortalPermission(request, baseEnv, "directory.read");
    if (denied) return denied;
    const access = portalAccess(request, baseEnv);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    try { return json(await listApprovals(baseEnv, access, Number.isFinite(limit) ? limit : 100)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load approvals" }, 503); }
  }

  const approvalActionMatch = url.pathname.match(/^\/api\/integrations\/approvals\/([A-Za-z0-9_-]{1,160})\/(approve|reject|cancel|execute)$/);
  if (request.method === "POST" && approvalActionMatch) {
    const approvalId = approvalActionMatch[1];
    const action = approvalActionMatch[2];
    const requiredPermission: PortalPermission = action === "approve" || action === "reject" ? "xyops.approve" : "xyops.run";
    const denied = requirePortalPermission(request, baseEnv, requiredPermission);
    if (denied) return denied;
    const access = portalAccess(request, baseEnv);
    let body: Record<string, unknown> = {};
    try { body = await request.json() as Record<string, unknown>; } catch {}
    try {
      if (action === "approve" || action === "reject") {
        const approval = await decideApproval(baseEnv, approvalId, access, action, String(body.comment ?? ""));
        const correlationId = await auditCorrelationFor(baseEnv, { approvalId }).catch(() => null);
        const linkedAudit = withAuditCorrelation(audit, correlationId);
        await appendAuditEvent(baseEnv, linkedAudit, { action: `approval.${action}`, resourceType: "approval", resourceId: approvalId, eventId: approval.eventId, schemaVersion: approval.schemaVersion, approvalId, runId: approval.runId, outcome: "success", metadata: { decision: action, commentProvided: Boolean(String(body.comment ?? "").trim()), approvals: approval.approvals, rejections: approval.rejections, requiredApprovals: approval.requiredApprovals, status: approval.status } }).catch(() => {});
        return json({ approval });
      }
      if (action === "cancel") {
        const approval = await cancelApproval(baseEnv, approvalId, access);
        const correlationId = await auditCorrelationFor(baseEnv, { approvalId }).catch(() => null);
        await appendAuditEvent(baseEnv, withAuditCorrelation(audit, correlationId), { action: "approval.cancel", resourceType: "approval", resourceId: approvalId, eventId: approval.eventId, schemaVersion: approval.schemaVersion, approvalId, outcome: "success", metadata: { status: approval.status } }).catch(() => {});
        return json({ approval });
      }

      const claimed = await claimApprovalExecution(baseEnv, approvalId, access);
      const approvalCorrelation = await auditCorrelationFor(baseEnv, { approvalId }).catch(() => null);
      const executionAudit = withAuditCorrelation(audit, approvalCorrelation);
      const secretValues = body.secretValues && typeof body.secretValues === "object" && !Array.isArray(body.secretValues) ? body.secretValues as Record<string, unknown> : {};
      const allowedSecretFields = new Set(claimed.spec.secretFields);
      if (Object.keys(secretValues).some((key) => !allowedSecretFields.has(key))) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Переданы неожиданные секретные поля");
        return json({ error: "Переданы неожиданные секретные поля" }, 400);
      }
      const values = { ...claimed.spec.values };
      for (const key of claimed.spec.secretFields) {
        const secret = typeof secretValues[key] === "string" ? secretValues[key] as string : "";
        if (!secret) {
          await finishApprovalExecution(baseEnv, approvalId, "failed", "", `Секретное поле ${key} не заполнено`);
          return json({ error: `Введите секретное поле: ${key}` }, 400);
        }
        values[key] = secret;
      }
      const catalog = await loadCatalog(env, xyopsUrl);
      const event = catalog.events.find((item) => item.id === claimed.spec.eventId && item.enabled);
      if (!event || !event.schemaVersion || event.schemaVersion !== claimed.spec.schemaVersion) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Схема процесса изменилась");
        return json({ error: "Схема процесса изменилась. Создайте новую заявку." }, 409);
      }
      const visibility = await readCatalogPolicySet(baseEnv);
      if (!catalogEventAllowed(visibility.policy, access, event)) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Процесс больше недоступен инициатору");
        return json({ error: "Процесс больше недоступен по политике каталога" }, 404);
      }
      const currentPolicy = await readApprovalPolicySet(baseEnv);
      const currentRequirement = approvalRequirement(currentPolicy.policy, access, event);
      if (!currentRequirement || claimed.approval.approvals < currentRequirement.requiredApprovals) {
        await finishApprovalExecution(baseEnv, approvalId, "failed", "", "Политика согласования изменилась");
        return json({ error: "Политика согласования изменилась. Создайте новую заявку." }, 409);
      }
      const runUrl = new URL(request.url);
      runUrl.pathname = "/api/integrations/catalog/run";
      runUrl.search = "";
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      headers.set("x-portal-approved-execution", approvalId);
      const launchResponse = await handleIntegrationApi(new Request(runUrl, {
        method: "POST", headers,
        body: JSON.stringify({ eventId: claimed.spec.eventId, values, targets: claimed.spec.targets, replayOf: claimed.spec.parentRunId }),
      }), baseEnv, runUrl, executionAudit);
      const payload = await launchResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (launchResponse.ok && typeof payload.runId === "string") {
        await finishApprovalExecution(baseEnv, approvalId, "executed", payload.runId);
        await appendAuditEvent(baseEnv, executionAudit, { action: "approval.execute", resourceType: "approval", resourceId: approvalId, eventId: claimed.spec.eventId, schemaVersion: claimed.spec.schemaVersion, approvalId, runId: payload.runId, jobId: String(payload.jobId ?? ""), outcome: "success", metadata: { status: "executed", secretFieldCount: claimed.spec.secretFields.length, parentRunId: claimed.spec.parentRunId } }).catch(() => {});
        return json({ ...payload, approvalId, approvalExecuted: true }, launchResponse.status);
      }
      const executionOutcome = launchResponse.status >= 500 ? "unknown" : "failure";
      await finishApprovalExecution(baseEnv, approvalId, launchResponse.status >= 500 ? "unknown" : "failed", String(payload.runId ?? ""), String(payload.error ?? "XYOps launch failed"));
      await appendAuditEvent(baseEnv, executionAudit, { action: "approval.execute", resourceType: "approval", resourceId: approvalId, eventId: claimed.spec.eventId, schemaVersion: claimed.spec.schemaVersion, approvalId, runId: String(payload.runId ?? ""), outcome: executionOutcome, errorCode: "xyops_launch_failed", metadata: { httpStatus: launchResponse.status } }).catch(() => {});
      return json({ ...payload, approvalId }, launchResponse.status);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Approval action failed" }, 409);
    }
  }



  if (request.method === "GET" && url.pathname === "/api/integrations/routes") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    const routes = automationRoutes(env);
    return json({ mode: boolValue(env.DEMO_MODE) ? "demo" : routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });
  }

  if (request.method === "PUT" && url.pathname === "/api/integrations/routes") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!baseEnv.ADMIN_TOKEN || !await adminAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (!baseEnv.DB || !baseEnv.CONFIG_ENCRYPTION_KEY) return json({ error: "Persistent encrypted storage is unavailable" }, 503);
    try {
      const body = await request.json() as Record<string, unknown>;
      const routes = sanitizeRoutes(body.routes);
      const current = await readStoredSettings(baseEnv) ?? envSettings(baseEnv);
      const next = { ...current, config: { ...current.config, routes }, updatedAt: Date.now() };
      await saveStoredSettings(baseEnv, next);
      await appendAuditEvent(baseEnv, audit, { action: "routes.updated", resourceType: "automation_routes", resourceId: "current", outcome: "success", metadata: { routeCount: routes.length, enabledCount: routes.filter((route) => route.enabled !== false).length, eventIds: routes.map((route) => route.eventId).slice(0, 100) } }).catch(() => {});
      return json({ mode: routes.length ? "live" : "unconfigured", routes: routes.map(publicRoute) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot save routes" }, 400);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/catalog") {
    try {
      const catalog = await portalCatalog(env, xyopsUrl);
      const access = portalAccess(request, baseEnv);
      const policyState = await readCatalogPolicySet(baseEnv);
      const sourceEvents = catalog.events.filter((event) => catalogEventAllowed(policyState.policy, access, event));
      const visibleIds = new Set(sourceEvents.map((event) => event.id));
      const changes = catalog.changes.filter((change) => visibleIds.has(change.id) || catalogEventAllowed(policyState.policy, access, { id: change.id, category: "" }));
      const presentationState = await readProcessPresentationSet(baseEnv);
      const localePreferences = presentationLocalePreferences(url.searchParams.get("locale"), request.headers.get("accept-language"));
      const resolvedLocale = resolveProcessPresentationLocale(presentationState.metadata, localePreferences);
      const availableLocales = availableProcessPresentationLocales(presentationState.metadata);
      const events = applyProcessPresentation(sourceEvents, presentationState.metadata, localePreferences);
      const response = json({ ...catalog, events, changes, policy: { source: policyState.source, filtered: sourceEvents.length !== catalog.events.length }, presentation: { source: presentationState.source, updatedAt: presentationState.updatedAt, locale: resolvedLocale, availableLocales } });
      response.headers.set("vary", "Accept-Language");
      if (resolvedLocale) response.headers.set("content-language", resolvedLocale);
      return response;
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
      const access = portalAccess(request, baseEnv);
      const policyState = await readCatalogPolicySet(baseEnv);
      if (!event || !catalogEventAllowed(policyState.policy, access, event)) return json({ error: "XYOps process not found" }, 404);
      const field = event.fields.find((item) => item.key === url.searchParams.get("fieldKey"));
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
    return handleCatalogRunRequest(request, baseEnv, url, audit, undefined, { env, xyopsUrl });
  }

  if (request.method === "POST" && url.pathname === "/api/integrations/actions") {
    const denied = requirePortalPermission(request, baseEnv, "xyops.run");
    if (denied) return denied;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    if (typeof body.operation !== "string" || !allowedOperations.has(body.operation)) return json({ error: "Unsupported operation" }, 400);
    const routes = automationRoutes(env);
    const route = typeof body.routeKey === "string" ? routes.find((item) => item.key === body.routeKey) : routes.find((item) => item.operation === body.operation && item.enabled !== false);
    if (!route || route.enabled === false || route.operation !== body.operation) return json({ error: "Automation route not found" }, 400);
    const runUrl = new URL(request.url);
    runUrl.pathname = "/api/integrations/catalog/run";
    runUrl.search = "";
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    return handleIntegrationApi(new Request(runUrl, {
      method: "POST", headers,
      body: JSON.stringify({ eventId: route.eventId, values: body, targets: route.targets ?? [] }),
    }), baseEnv, runUrl, audit);
  }

  return json({ error: "Not found" }, 404);
}

export default worker;
