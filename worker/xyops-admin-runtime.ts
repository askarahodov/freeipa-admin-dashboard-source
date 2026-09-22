import type { AutomationRoute, RouteField } from "../src/automation/automation-types";
import { allowedAutomationOperations } from "../src/automation/automation-operations.ts";
import { normalizeFieldCondition } from "../src/automation/field-conditions";
import {
  decryptIntegrationSecrets as decryptSecrets,
  encryptIntegrationSecrets as encryptSecrets,
} from "./integration-settings-runtime.ts";

export interface XyOpsAdminRuntimeEnv {
  DB?: D1Database;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  XYOPS_EVENT_ID?: string;
  XYOPS_ROUTES_JSON?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
}

function cleanBaseUrl(value?: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return null;
    return parsed.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function boolValue(value: unknown): boolean {
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

export async function readStoredSettings(env: XyOpsAdminRuntimeEnv): Promise<StoredSettings | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?").bind("main").first<{ config_json: string; encrypted_secrets: string; updated_at: number }>();
  if (!row) return null;
  const config = JSON.parse(row.config_json) as Partial<StoredConfig>;
  const secrets = await decryptSecrets(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
  return { config: { demoMode: config.demoMode === true, ipaUrl: String(config.ipaUrl ?? ""), ipaUsername: String(config.ipaUsername ?? ""), xyopsUrl: String(config.xyopsUrl ?? ""), routes: Array.isArray(config.routes) ? sanitizeRoutes(config.routes) : undefined }, secrets, updatedAt: Number(row.updated_at) };
}

export async function saveStoredSettings(env: XyOpsAdminRuntimeEnv, settings: StoredSettings): Promise<void> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const encryptedSecrets = await encryptSecrets(settings.secrets, env.CONFIG_ENCRYPTION_KEY);
  await env.DB.prepare("INSERT INTO app_settings (id, config_json, encrypted_secrets, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, encrypted_secrets = excluded.encrypted_secrets, updated_at = excluded.updated_at").bind("main", JSON.stringify(settings.config), encryptedSecrets, settings.updatedAt).run();
}

export function envSettings(env: XyOpsAdminRuntimeEnv): StoredSettings {
  return { config: { demoMode: boolValue(env.DEMO_MODE), ipaUrl: cleanBaseUrl(env.IPA_URL) ?? "", ipaUsername: env.IPA_USERNAME ?? "", xyopsUrl: cleanBaseUrl(env.XYOPS_URL) ?? "", routes: undefined }, secrets: { ipaPassword: env.IPA_PASSWORD ?? "", xyopsApiKey: env.XYOPS_API_KEY ?? "" }, updatedAt: 0 };
}

export async function effectiveSettings(env: XyOpsAdminRuntimeEnv): Promise<StoredSettings> {
  try { return await readStoredSettings(env) ?? envSettings(env); } catch { return envSettings(env); }
}

export async function effectiveEnv<T extends XyOpsAdminRuntimeEnv>(env: T): Promise<T> {
  const settings = await effectiveSettings(env);
  return {
    ...env,
    DEMO_MODE: settings.config.demoMode ? "true" : "false",
    IPA_URL: settings.config.ipaUrl,
    IPA_USERNAME: settings.config.ipaUsername,
    IPA_PASSWORD: settings.secrets.ipaPassword,
    XYOPS_URL: settings.config.xyopsUrl,
    XYOPS_API_KEY: settings.secrets.xyopsApiKey,
    XYOPS_ROUTES_JSON: settings.config.routes ? JSON.stringify(settings.config.routes) : env.XYOPS_ROUTES_JSON,
  } as T;
}

export async function resolveCatalogRuntime<T extends XyOpsAdminRuntimeEnv>(env: T): Promise<{ env: T; xyopsUrl: string | null }> {
  const effective = await effectiveEnv(env);
  return { env: effective, xyopsUrl: cleanBaseUrl(effective.XYOPS_URL) };
}

export const allowedOperations = new Set<string>(allowedAutomationOperations);

export function sanitizeRoutes(raw: unknown): AutomationRoute[] {
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

export function automationRoutes(env: XyOpsAdminRuntimeEnv): AutomationRoute[] {
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

export function publicRoute(route: AutomationRoute) {
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

export function normalizeXyFields(rawFields: unknown[], parentPath: string[] = []): RouteField[] {
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
