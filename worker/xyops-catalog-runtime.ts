import type { CatalogEvent } from "../src/automation/automation-types";
import {
  automationRoutes,
  normalizeXyFields,
  type XyOpsAdminRuntimeEnv,
} from "./xyops-admin-runtime.ts";
import { xyopsPayloadSucceeded } from "./xyops-run-runtime.ts";

export type XyOpsCatalogRuntimeEnv = XyOpsAdminRuntimeEnv;

type CatalogChange = { id: string; title: string; kind: "new" | "changed" | "removed" };
type CatalogSnapshot = { events: CatalogEvent[]; syncedAt: number };

async function readCatalogSnapshot(env: XyOpsCatalogRuntimeEnv): Promise<CatalogSnapshot | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT catalog_json, synced_at FROM xyops_catalog_snapshot WHERE id = ?").bind("current").first<{ catalog_json: string; synced_at: number }>();
  if (!row) return null;
  try {
    const events = JSON.parse(row.catalog_json) as CatalogEvent[];
    return Array.isArray(events) ? { events: events.filter((event) => event && typeof event.id === "string"), syncedAt: Number(row.synced_at) } : null;
  } catch { return null; }
}

async function saveCatalogSnapshot(env: XyOpsCatalogRuntimeEnv, events: CatalogEvent[], syncedAt: number): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO xyops_catalog_snapshot (id, catalog_json, synced_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET catalog_json = excluded.catalog_json, synced_at = excluded.synced_at")
    .bind("current", JSON.stringify(events), syncedAt).run();
}

async function saveCatalogHistory(env: XyOpsCatalogRuntimeEnv, events: CatalogEvent[], changes: CatalogChange[], syncedAt: number): Promise<void> {
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

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function boolValue(value: unknown): boolean {
  const raw = firstValue(value);
  if (typeof raw === "boolean") return raw;
  return ["true", "1", "yes", "on"].includes(String(raw ?? "").toLowerCase());
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

function demoCatalog(env: XyOpsCatalogRuntimeEnv): CatalogEvent[] {
  const routeEvents = automationRoutes(env).map((route) => ({ id: route.eventId, title: route.title, description: "Маршрут администрирования FreeIPA", operation: route.operation, kind: route.kind, enabled: route.enabled !== false, category: "FreeIPA", plugin: route.kind === "workflow" ? null : "freeipa", fields: route.fields ?? [], targets: route.targets ?? [], dangerous: false }));
  const events: CatalogEvent[] = [...routeEvents, { id: "database-backup", title: "Резервное копирование базы данных", description: "Создание и проверка резервной копии выбранной БД", kind: "workflow", enabled: true, category: "Databases", plugin: null, targets: ["db-prod-01", "db-stage-01"], dangerous: false, fields: [
    { key: "database", label: "База данных", type: "string", required: true, target: "workflowData", placeholder: "billing" },
    { key: "backupType", label: "Тип копии", type: "select", required: true, target: "workflowData", options: ["full", "incremental"], default: "full" },
    { key: "retentionDays", label: "Хранить, дней", type: "number", required: true, target: "workflowData", default: 14, min: 1, max: 365 },
    { key: "verify", label: "Проверить копию после создания", type: "boolean", target: "workflowData", default: true },
  ] }];
  return events.map((event) => ({ ...event, schemaVersion: schemaFingerprint(event) }));
}

export async function loadCatalog(env: XyOpsCatalogRuntimeEnv, xyopsUrl: string | null): Promise<{ mode: "demo" | "live" | "unconfigured"; events: CatalogEvent[] }> {
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

export async function portalCatalog(env: XyOpsCatalogRuntimeEnv, xyopsUrl: string | null): Promise<{ mode: "demo" | "live" | "cached" | "unconfigured"; source: "demo" | "xyops" | "cache" | "none"; events: CatalogEvent[]; syncedAt: string | null; stale: boolean; changes: CatalogChange[] }> {
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
