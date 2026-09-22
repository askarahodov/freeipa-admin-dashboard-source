/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleFrameworkRequest } from "./framework-http-entry.ts";
import type { FrameworkHttpContext, FrameworkHttpEnv } from "./framework-http.ts";
import type { AutomationRoute, CatalogEvent, RouteField } from "../src/automation/automation-types";
import { normalizeFieldCondition } from "../src/automation/field-conditions";
import { catalogEventAllowed, readCatalogPolicySet, saveCatalogPolicySet } from "../src/operations/catalog/catalog-policies";
import { readApprovalPolicySet, saveApprovalPolicySet } from "../src/operations/approvals/approval-gates";
import { appendAuditEvent, auditCorrelationFor, auditErrorCode, createAuditContext, listAuditEvents, withAuditCorrelation, type AuditContext } from "../audit-log";
import { applyProcessPresentation, availableProcessPresentationLocales, presentationLocalePreferences, readProcessPresentationSet, resolveProcessPresentationLocale, saveProcessPresentationSet } from "../src/operations/presentation/process-presentation";
import { freeIpaRpc as ipaRpc } from "./freeipa-rpc.ts";
import { decryptIntegrationSecrets as decryptSecrets, encryptIntegrationSecrets as encryptSecrets } from "./integration-settings-runtime.ts";
import { portalAccess, requestActor, requirePortalPermission } from "./portal-access-runtime.ts";
import { xyopsPayloadSucceeded } from "./xyops-run-runtime.ts";

interface Env extends FrameworkHttpEnv {
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
}

type ExecutionContext = FrameworkHttpContext;

type CatalogChange = { id: string; title: string; kind: "new" | "changed" | "removed" };
type CatalogSnapshot = { events: CatalogEvent[]; syncedAt: number };
const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const runtimeEnv = env ?? (process.env as unknown as Env);

    if (url.pathname.startsWith("/api/integrations/")) {
      return handleIntegrationApi(request, runtimeEnv, url);
    }

    return handleFrameworkRequest(request, runtimeEnv, ctx);
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

export async function resolveCatalogRuntime(env: Env): Promise<{ env: Env; xyopsUrl: string | null }> {
  const effective = await effectiveEnv(env);
  return { env: effective, xyopsUrl: cleanBaseUrl(effective.XYOPS_URL) };
}

export const allowedOperations = new Set(["user_add", "user_mod", "user_password", "user_enable", "user_disable", "user_del", "group_add", "group_del", "group_add_member", "group_remove_member"]);

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

export function automationRoutes(env: Env): AutomationRoute[] {
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

export async function loadCatalog(env: Env, xyopsUrl: string | null): Promise<{ mode: "demo" | "live" | "unconfigured"; events: CatalogEvent[] }> {
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

export async function portalCatalog(env: Env, xyopsUrl: string | null): Promise<{ mode: "demo" | "live" | "cached" | "unconfigured"; source: "demo" | "xyops" | "cache" | "none"; events: CatalogEvent[]; syncedAt: string | null; stale: boolean; changes: CatalogChange[] }> {
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

async function handleIntegrationApi(request: Request, baseEnv: Env, url: URL, inheritedAudit?: AuditContext): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/integrations/health") return json({ ok: true });
  const audit = inheritedAudit ?? createAuditContext(portalAccess(request, baseEnv));
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


  return json({ error: "Not found" }, 404);
}

export default worker;
