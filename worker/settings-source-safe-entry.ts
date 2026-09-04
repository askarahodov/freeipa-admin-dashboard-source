import sourceRuntime from "./settings-source-entry";
import lifecycleRuntime from "./settings-lifecycle-entry";
import { appendAuditEvent, createAuditContext } from "../audit-log";
import {
  portalRolePermissions,
  resolvePortalRole,
  type PortalPermission,
} from "../src/auth/portal-permissions";

type RuntimeEnv = NonNullable<Parameters<typeof lifecycleRuntime.fetch>[1]> & {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};
type RuntimeContext = Parameters<typeof lifecycleRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof sourceRuntime.scheduled>>[0];
type SettingField = "demoMode" | "ipaUrl" | "ipaUsername" | "ipaPassword" | "xyopsUrl" | "xyopsApiKey";
type SourceAccess = { identity: string; permissions: PortalPermission[] };
type StoredSecrets = { ipaPassword: string; xyopsApiKey: string };
type SettingsRow = { config_json: string; encrypted_secrets: string; updated_at: number };

const settingFields: SettingField[] = ["demoMode", "ipaUrl", "ipaUsername", "ipaPassword", "xyopsUrl", "xyopsApiKey"];
const settingsSelectSql = "SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?";
const releaseLockSql = "DELETE FROM portal_settings_source_lock WHERE id = ? AND owner = ?";
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function resultChanges(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = result as { meta?: { changes?: number }; changes?: number };
  return Number(value.meta?.changes ?? value.changes ?? 0);
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

function resolvedAccess(request: Request, env: RuntimeEnv): SourceAccess {
  const identity = String(env.PORTAL_STATIC_IDENTITY || request.headers.get("oai-authenticated-user-email") || "service-admin@portal.local")
    .trim().toLowerCase().slice(0, 160);
  const role = resolvePortalRole(identity, env.PORTAL_DEFAULT_ROLE, env.PORTAL_RBAC_JSON, "admin");
  return { identity, permissions: portalRolePermissions[role] };
}

async function sourceAccess(request: Request, env: RuntimeEnv): Promise<SourceAccess | null> {
  if (!await secretsMatch(request.headers.get("x-admin-token"), env.ADMIN_TOKEN)) return null;
  const access = resolvedAccess(request, env);
  return access.permissions.includes("settings.manage") ? access : null;
}

export async function authorizeSettingsMutation(request: Request, env: RuntimeEnv, _ctx: RuntimeContext): Promise<Response | null> {
  return await sourceAccess(request, env) ? null : json({ error: "Administrator authorization required" }, 401);
}

function isSettingField(value: unknown): value is SettingField {
  return settingFields.includes(value as SettingField);
}

function uniqueFields(values: SettingField[]): SettingField[] {
  return Array.from(new Set(values));
}

function parseResetFields(body: Record<string, unknown>): SettingField[] {
  const changes = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes)
    ? body.changes as Record<string, unknown> : body;
  if (changes.resetFields === undefined) return [];
  if (!Array.isArray(changes.resetFields)) throw new Error("resetFields must be an array");
  return uniqueFields(changes.resetFields.map((value) => {
    if (!isSettingField(value)) throw new Error(`Unsupported reset field: ${String(value)}`);
    return value;
  }));
}

function resetConflicts(body: Record<string, unknown>, resets: SettingField[]): SettingField[] {
  const changes = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes)
    ? body.changes as Record<string, unknown> : body;
  const resetSet = new Set(resets);
  const conflicts: SettingField[] = [];
  if (changes.demoMode !== undefined && resetSet.has("demoMode")) conflicts.push("demoMode");
  if (changes.ipaUrl !== undefined && resetSet.has("ipaUrl")) conflicts.push("ipaUrl");
  if (changes.ipaUsername !== undefined && resetSet.has("ipaUsername")) conflicts.push("ipaUsername");
  if ((changes.ipaPassword !== undefined || changes.clearIpaPassword !== undefined) && resetSet.has("ipaPassword")) conflicts.push("ipaPassword");
  if (changes.xyopsUrl !== undefined && resetSet.has("xyopsUrl")) conflicts.push("xyopsUrl");
  if ((changes.xyopsApiKey !== undefined || changes.clearXyopsApiKey !== undefined) && resetSet.has("xyopsApiKey")) conflicts.push("xyopsApiKey");
  return uniqueFields(conflicts);
}

function boolValue(value: unknown): boolean {
  return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function environmentUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.href.replace(/\/$/, "");
  } catch { return ""; }
}

function configuredEnv(value: unknown): boolean {
  return typeof value === "string" ? Boolean(value.trim()) : value !== undefined;
}

function environmentValue(field: SettingField, env: RuntimeEnv): unknown {
  if (field === "demoMode") return boolValue(env.DEMO_MODE);
  if (field === "ipaUrl") return environmentUrl(env.IPA_URL);
  if (field === "ipaUsername") return String(env.IPA_USERNAME ?? "").trim();
  if (field === "ipaPassword") return String(env.IPA_PASSWORD ?? "");
  if (field === "xyopsUrl") return environmentUrl(env.XYOPS_URL);
  return String(env.XYOPS_API_KEY ?? "");
}

function transformedDraftBody(body: Record<string, unknown>, resets: SettingField[], env: RuntimeEnv): Record<string, unknown> {
  const nested = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes);
  const changes = { ...(nested ? body.changes as Record<string, unknown> : body) };
  delete changes.resetFields;
  for (const field of resets) {
    const value = environmentValue(field, env);
    if (field === "ipaPassword") {
      delete changes.clearIpaPassword;
      if (configuredEnv(value)) changes.ipaPassword = String(value);
      else { delete changes.ipaPassword; changes.clearIpaPassword = true; }
    } else if (field === "xyopsApiKey") {
      delete changes.clearXyopsApiKey;
      if (configuredEnv(value)) changes.xyopsApiKey = String(value);
      else { delete changes.xyopsApiKey; changes.clearXyopsApiKey = true; }
    } else changes[field] = value;
  }
  return nested ? { ...body, changes } : { ...changes, baseRevision: body.baseRevision };
}

function overrideSet(config: Record<string, unknown> | null): Set<SettingField> {
  if (!config) return new Set();
  if (!Object.prototype.hasOwnProperty.call(config, "overrides")) return new Set(settingFields);
  return new Set(Array.isArray(config.overrides) ? config.overrides.filter(isSettingField) : []);
}

async function activeOverrides(env: RuntimeEnv): Promise<Set<SettingField>> {
  if (!env.DB) return new Set();
  const row = await env.DB.prepare("SELECT config_json FROM app_settings WHERE id = ?").bind("main").first<{ config_json: string }>();
  if (!row) return new Set();
  try {
    const parsed = JSON.parse(String(row.config_json ?? "{}")) as unknown;
    return overrideSet(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {});
  } catch { return new Set(); }
}

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
  else bytes = base64ToBytes(normalized);
  if (bytes.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function decryptSecrets(value: string, keyValue?: string): Promise<StoredSecrets> {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) return { ipaPassword: "", xyopsApiKey: "" };
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<StoredSecrets>;
  return { ipaPassword: String(parsed.ipaPassword ?? ""), xyopsApiKey: String(parsed.xyopsApiKey ?? "") };
}

async function encryptSecrets(secrets: StoredSecrets, keyValue?: string): Promise<string> {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(secrets)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

function virtualPrepared(statement: D1PreparedStatement, virtualRow: SettingsRow, intercept: boolean): D1PreparedStatement {
  return new Proxy(statement as object, {
    get(target, property, receiver) {
      if (property === "bind") return (...args: unknown[]) => virtualPrepared((target as D1PreparedStatement).bind(...args), virtualRow, intercept);
      if (property === "first" && intercept) return async () => ({ ...virtualRow });
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1PreparedStatement;
}

async function dynamicInheritedEnv(env: RuntimeEnv): Promise<RuntimeEnv> {
  if (!env.DB || !env.CONFIG_ENCRYPTION_KEY) return env;
  try {
    const row = await env.DB.prepare(settingsSelectSql).bind("main").first<SettingsRow>();
    if (!row) return env;
    const parsed = JSON.parse(String(row.config_json ?? "{}")) as unknown;
    const config = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    const overrides = overrideSet(config);
    if (overrides.size === settingFields.length) return env;
    const secrets = await decryptSecrets(String(row.encrypted_secrets ?? ""), env.CONFIG_ENCRYPTION_KEY);
    const nextConfig = { ...config };
    const nextSecrets = { ...secrets };
    for (const field of settingFields) {
      if (overrides.has(field)) continue;
      const value = environmentValue(field, env);
      if (field === "ipaPassword") nextSecrets.ipaPassword = configuredEnv(value) ? String(value) : "";
      else if (field === "xyopsApiKey") nextSecrets.xyopsApiKey = configuredEnv(value) ? String(value) : "";
      else nextConfig[field] = value;
    }
    const virtualRow: SettingsRow = {
      config_json: JSON.stringify(nextConfig),
      encrypted_secrets: await encryptSecrets(nextSecrets, env.CONFIG_ENCRYPTION_KEY),
      updated_at: Number(row.updated_at ?? 0),
    };
    const database = new Proxy(env.DB as object, {
      get(target, property, receiver) {
        if (property === "prepare") return (sql: string) => virtualPrepared((target as D1Database).prepare(sql), virtualRow, sql.trim() === settingsSelectSql);
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    return { ...env, DB: database };
  } catch { return env; }
}

async function acquireSourceLock(env: RuntimeEnv): Promise<string | null> {
  if (!env.DB) return "no-database";
  const now = Date.now();
  await env.DB.prepare("DELETE FROM portal_settings_source_lock WHERE id = ? AND acquired_at < ?").bind("main", now - 60_000).run();
  const owner = crypto.randomUUID();
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO portal_settings_source_lock (id, owner, acquired_at) VALUES (?, ?, ?)")
    .bind("main", owner, now).run();
  return resultChanges(inserted) === 1 ? owner : null;
}

async function releaseSourceLock(env: RuntimeEnv, owner: string): Promise<void> {
  if (!env.DB || owner === "no-database") return;
  await env.DB.prepare(releaseLockSql).bind("main", owner).run();
}

async function withSourceLock(env: RuntimeEnv, operation: () => Promise<Response>): Promise<Response> {
  const owner = await acquireSourceLock(env);
  if (!owner) return json({ error: "Другая операция уже изменяет источники настроек", code: "settings_source_busy" }, 409);
  try { return await operation(); }
  finally { await releaseSourceLock(env, owner).catch(() => {}); }
}

function wrapPrepared(statement: object, swallowRelease: boolean): object {
  return new Proxy(statement, {
    get(target, property, receiver) {
      if (property === "bind") return (...args: unknown[]) => wrapPrepared((target as { bind: (...values: unknown[]) => object }).bind(...args), swallowRelease);
      if (property === "run" && swallowRelease) return async () => {
        try { return await (target as { run: () => Promise<unknown> }).run(); }
        catch { return { success: true, meta: { changes: 0 } }; }
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function bestEffortReleaseEnv(env: RuntimeEnv): RuntimeEnv {
  if (!env.DB) return env;
  const database = new Proxy(env.DB as object, {
    get(target, property, receiver) {
      if (property === "prepare") return (sql: string) => wrapPrepared((target as D1Database).prepare(sql) as object, sql.trim() === releaseLockSql) as D1PreparedStatement;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
  return { ...env, DB: database };
}

function audit(identity: string) {
  return createAuditContext({ identity, role: "admin", groups: [] });
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.clone().json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

async function cleanupFailedResetDraft(env: RuntimeEnv, draftId: string): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM portal_settings_draft_resets WHERE draft_id = ?").bind(draftId),
      env.DB.prepare("DELETE FROM portal_settings_drafts WHERE id = ? AND status IN ('draft','validated','invalid')").bind(draftId),
    ]);
    return resultChanges(results[1]) === 1;
  } catch { return false; }
}

async function createResetDraft(request: Request, env: RuntimeEnv, ctx: RuntimeContext, access: SourceAccess): Promise<Response> {
  if (!env.DB) return json({ error: "Persistent database is unavailable" }, 503);
  let body: Record<string, unknown>;
  try { body = await request.clone().json() as Record<string, unknown>; }
  catch { return json({ error: "Invalid JSON" }, 400); }
  let resets: SettingField[];
  try { resets = parseResetFields(body); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid reset fields" }, 400); }
  if (!resets.length) return sourceRuntime.fetch(request, bestEffortReleaseEnv(env), ctx);
  const conflicts = resetConflicts(body, resets);
  if (conflicts.length) return json({ error: `Fields cannot be changed and reset together: ${conflicts.join(", ")}`, code: "settings_reset_conflict", fields: conflicts }, 400);

  return withSourceLock(env, async () => {
    const overrides = await activeOverrides(env);
    const invalid = resets.filter((field) => !overrides.has(field));
    if (invalid.length) return json({ error: `Fields are not overridden in D1: ${invalid.join(", ")}`, code: "settings_field_not_overridden", fields: invalid }, 409);
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const response = await lifecycleRuntime.fetch(new Request(request.url, {
      method: "POST", headers, body: JSON.stringify(transformedDraftBody(body, resets, env)),
    }), env, ctx);
    if (!response.ok) return response;
    const payload = await responsePayload(response);
    const draft = payload.draft && typeof payload.draft === "object" && !Array.isArray(payload.draft) ? payload.draft as Record<string, unknown> : {};
    const draftId = String(draft.id ?? "");
    if (!draftId) return json({ error: "Draft creation did not return an identifier" }, 500);
    try {
      const inserted = await env.DB!.prepare("INSERT INTO portal_settings_draft_resets (draft_id, reset_fields_json, created_at) VALUES (?, ?, ?)")
        .bind(draftId, JSON.stringify(resets), Date.now()).run();
      if (resultChanges(inserted) !== 1) throw new Error("Reset metadata was not persisted");
    } catch {
      const cleaned = await cleanupFailedResetDraft(env, draftId);
      await appendAuditEvent(env, audit(access.identity), {
        action: "settings.override.reset_request_failed", resourceType: "portal_settings_draft", resourceId: draftId,
        outcome: "failure", metadata: { fields: resets, cleaned },
      }).catch(() => {});
      return json({ error: "Не удалось атомарно сохранить reset metadata", code: cleaned ? "settings_reset_metadata_failed" : "settings_reset_cleanup_conflict", cleaned }, cleaned ? 500 : 409);
    }
    await appendAuditEvent(env, audit(access.identity), {
      action: "settings.override.reset_requested", resourceType: "portal_settings_draft", resourceId: draftId,
      outcome: "pending", metadata: { fields: resets, baseRevision: Number(draft.baseRevision ?? 0) },
    }).catch(() => {});
    const readUrl = new URL(request.url);
    readUrl.pathname = `/api/integrations/settings/drafts/${encodeURIComponent(draftId)}`;
    const refreshed = await sourceRuntime.fetch(new Request(readUrl, { method: "GET", headers: request.headers }), bestEffortReleaseEnv(env), ctx);
    return refreshed.ok ? json(await responsePayload(refreshed), response.status) : json(payload, response.status);
  });
}

async function auditCompensation(request: Request, env: RuntimeEnv, response: Response): Promise<void> {
  if (response.ok) return;
  const payload = await responsePayload(response);
  if (!["settings_source_commit_failed", "settings_source_rollback_conflict"].includes(String(payload.code ?? ""))) return;
  const access = await sourceAccess(request, env);
  if (!access) return;
  const routes = new URL(request.url).pathname === "/api/integrations/routes";
  await appendAuditEvent(env, audit(access.identity), {
    action: routes ? "routes.updated.compensated_rollback" : "settings.updated.compensated_rollback",
    resourceType: routes ? "automation_routes" : "portal_settings", resourceId: "current",
    outcome: payload.rolledBack === true ? "failure" : "unknown",
    metadata: { rolledBack: payload.rolledBack === true, code: String(payload.code ?? "") },
  }).catch(() => {});
}

function requiresSourceRuntime(request: Request): boolean {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/integrations/settings/effective") return true;
  if (request.method === "PUT" && (url.pathname === "/api/integrations/settings" || url.pathname === "/api/integrations/routes")) return true;
  return url.pathname === "/api/integrations/settings/drafts" || url.pathname.startsWith("/api/integrations/settings/drafts/");
}

function isOperationalIntegrationRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith("/api/integrations/") && pathname !== "/api/integrations/health";
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    if (!requiresSourceRuntime(request)) {
      const operationalEnv = isOperationalIntegrationRequest(request) ? await dynamicInheritedEnv(sourceEnv) : sourceEnv;
      return lifecycleRuntime.fetch(request, operationalEnv, ctx);
    }
    const access = await sourceAccess(request, sourceEnv);
    if (!access) return json({ error: "Administrator authorization required" }, 401);
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/integrations/settings/drafts") return createResetDraft(request, sourceEnv, ctx, access);
    const response = await sourceRuntime.fetch(request, bestEffortReleaseEnv(sourceEnv), ctx);
    if (request.method === "PUT" && (url.pathname === "/api/integrations/settings" || url.pathname === "/api/integrations/routes")) {
      ctx.waitUntil(auditCompensation(request, sourceEnv, response));
    }
    return response;
  },
  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return sourceRuntime.scheduled?.(controller, bestEffortReleaseEnv(env ?? (process.env as unknown as RuntimeEnv)), ctx);
  },
};

export default worker;
