/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_VERIFY_TLS?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  XYOPS_EVENT_ID?: string;
  XYOPS_ROUTES_JSON?: string;
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function cleanBaseUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
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

type RouteField = {
  key: string;
  label: string;
  type: "string" | "password" | "textarea" | "boolean" | "number" | "select" | "multiselect" | "date" | "datetime" | "json";
  required?: boolean;
  target?: "params" | "input" | "workflowData";
  options?: string[];
  default?: string | number | boolean | string[];
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
};

type CatalogEvent = {
  id: string;
  title: string;
  description: string;
  kind: "event" | "workflow";
  enabled: boolean;
  category: string;
  plugin: string | null;
  fields: RouteField[];
  targets: string[];
  dangerous: boolean;
};

type AutomationRoute = {
  key: string;
  title: string;
  operation: string;
  kind: "event" | "workflow";
  eventId: string;
  enabled?: boolean;
  targets?: string[];
  fields?: RouteField[];
};

const allowedOperations = new Set(["user_add", "user_enable", "user_disable", "user_del", "group_add", "group_del", "group_add_member", "group_remove_member"]);

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
  if (!env.XYOPS_ROUTES_JSON) return fallback;
  try {
    const parsed = JSON.parse(env.XYOPS_ROUTES_JSON) as AutomationRoute[];
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter((route) => route && typeof route.key === "string" && typeof route.title === "string" && typeof route.eventId === "string" && (route.kind === "event" || route.kind === "workflow") && allowedOperations.has(route.operation));
    return valid.length ? valid : fallback;
  } catch {
    return fallback;
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
    default: (source.value ?? source.default) as string | number | boolean | string[] | undefined,
    description: String(source.description ?? source.help ?? source.hint ?? ""),
    placeholder: String(source.placeholder ?? ""),
    min: typeof source.min === "number" ? source.min : undefined,
    max: typeof source.max === "number" ? source.max : undefined,
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

async function loadCatalog(env: Env, xyopsUrl: string | null): Promise<{ mode: "demo" | "live"; events: CatalogEvent[] }> {
  if (!xyopsUrl || !env.XYOPS_API_KEY) return { mode: "demo", events: demoCatalog(env) };
  const response = await fetch(`${xyopsUrl}/api/app/get_events/v1`, { method: "GET", headers: { "x-api-key": env.XYOPS_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("XYOps get_events failed");
  return { mode: "live", events: extractEventRows(payload).map(catalogItem).filter((event) => event.id) };
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

async function handleIntegrationApi(request: Request, env: Env, url: URL): Promise<Response> {
  const ipaUrl = cleanBaseUrl(env.IPA_URL);
  const xyopsUrl = cleanBaseUrl(env.XYOPS_URL);

  if (request.method === "GET" && url.pathname === "/api/integrations/status") {
    const ipaConfigured = Boolean(ipaUrl && env.IPA_USERNAME && env.IPA_PASSWORD);
    const xyopsConfigured = Boolean(xyopsUrl && env.XYOPS_API_KEY && automationRoutes(env).some((route) => route.enabled !== false && route.eventId));
    const [ipaReachable, xyopsReachable] = await Promise.all([ipaConfigured ? reachable(ipaUrl) : false, xyopsConfigured ? reachable(xyopsUrl) : false]);
    return json({ mode: ipaConfigured || xyopsConfigured ? "live" : "demo", freeipa: { configured: ipaConfigured, reachable: ipaReachable }, xyops: { configured: xyopsConfigured, reachable: xyopsReachable } });
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/routes") {
    return json({ mode: env.XYOPS_ROUTES_JSON ? "live" : "demo", routes: automationRoutes(env).map(publicRoute) });
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/catalog") {
    try {
      const catalog = await loadCatalog(env, xyopsUrl);
      return json({ ...catalog, syncedAt: new Date().toISOString() });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "XYOps catalog request failed" }, 502);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/integrations/catalog/run") {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON" }, 400); }
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
    try {
      const catalog = await loadCatalog(env, xyopsUrl);
      const event = catalog.events.find((item) => item.id === eventId && item.enabled);
      if (!event) return json({ error: "XYOps process not found or disabled" }, 404);
      const requestedTargets = Array.isArray(body.targets) ? body.targets.map(String) : [];
      if (event.targets.length && requestedTargets.some((target) => !event.targets.includes(target))) return json({ error: "Unsupported target" }, 400);
      const params: Record<string, unknown> = { source: "xyops-self-service" };
      const inputData: Record<string, unknown> = { source: "xyops-self-service" };
      const workflowData: Record<string, unknown> = {};
      for (const field of event.fields) {
        const value = coerceField(field, values[field.key]);
        if (value === null) return json({ error: `Invalid or missing field: ${field.key}` }, 400);
        if (value === "" && !field.required) continue;
        if (field.target === "workflowData") workflowData[field.key] = value;
        else if (field.target === "input") inputData[field.key] = value;
        else params[field.key] = value;
      }
      const launchPayload = { id: event.id, params, input: { data: inputData }, ...(event.kind === "workflow" ? { workflowData } : {}), ...(requestedTargets.length ? { targets: requestedTargets } : event.targets.length === 1 ? { targets: event.targets } : {}) };
      if (catalog.mode === "demo" || !xyopsUrl || !env.XYOPS_API_KEY) return json({ mode: "demo", queued: true, jobId: `DEMO-${Date.now()}`, process: { id: event.id, title: event.title, kind: event.kind } }, 202);
      const response = await fetch(`${xyopsUrl}/api/app/run_event/v1`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY }, body: JSON.stringify(launchPayload), signal: AbortSignal.timeout(15000) });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) return json({ error: "XYOps run_event failed", result }, 502);
      const resultData = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
      return json({ mode: "live", queued: true, jobId: String(result.job_id ?? result.jobId ?? result.id ?? resultData.job_id ?? ""), process: { id: event.id, title: event.title, kind: event.kind }, result }, 202);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "XYOps request failed" }, 502);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/integrations/users") {
    if (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD) return json({ mode: "demo", users: [] });
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
    if (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD) return json({ mode: "demo", groups: [] });
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
    if (!xyopsUrl || !env.XYOPS_API_KEY) {
      return json({ mode: "demo", queued: true, jobId: `DEMO-${Date.now()}` }, 202);
    }
    try {
      const response = await fetch(`${xyopsUrl}/api/app/run_event/v1`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.XYOPS_API_KEY },
        body: JSON.stringify({ id: route.eventId, params, input: { data: inputData }, ...(route.kind === "workflow" ? { workflowData } : {}), ...(route.targets?.length ? { targets: route.targets } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => ({}));
      return json({ mode: "live", queued: response.ok, result }, response.ok ? 202 : 502);
    } catch {
      return json({ error: "XYOps request failed" }, 502);
    }
  }

  return json({ error: "Not found" }, 404);
}

export default worker;
