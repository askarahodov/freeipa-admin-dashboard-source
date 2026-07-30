import runtime from "./settings-revisions-entry";
import { normalizeSettingsRequestBody } from "./settings-input-normalizer";

type RuntimeEnv = NonNullable<Parameters<typeof runtime.fetch>[1]> & {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
};
type RuntimeContext = Parameters<typeof runtime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof runtime.scheduled>>[0];
type SettingField = "demoMode" | "ipaUrl" | "ipaUsername" | "ipaPassword" | "xyopsUrl" | "xyopsApiKey";
type DraftRow = {
  changes_json: string;
  encrypted_secrets: string;
  status: string;
  updated_at: number;
};

const settingFields: SettingField[] = ["demoMode", "ipaUrl", "ipaUsername", "ipaPassword", "xyopsUrl", "xyopsApiKey"];
const createSourceMutationLockTable = `CREATE TABLE IF NOT EXISTS portal_settings_source_lock (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  acquired_at INTEGER NOT NULL
)`;
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resultChanges(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = result as { meta?: { changes?: number }; changes?: number };
  return Number(value.meta?.changes ?? value.changes ?? 0);
}

function isSettingField(value: unknown): value is SettingField {
  return settingFields.includes(value as SettingField);
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
  } catch {
    return "";
  }
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
    try { bytes = base64ToBytes(normalized); }
    catch { throw new Error("CONFIG_ENCRYPTION_KEY must be 32-byte base64 or 64-character hex"); }
  }
  if (bytes.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function decryptJson(value: string, keyValue?: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Unsupported encrypted settings format");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
  return objectValue(parsed) ?? {};
}

async function encryptJson(value: Record<string, unknown>, keyValue?: string): Promise<string> {
  if (!Object.keys(value).length) return "";
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

function resetFieldsFromBody(body: Record<string, unknown>): SettingField[] {
  const changes = objectValue(body.changes) ?? body;
  return Array.isArray(changes.resetFields)
    ? Array.from(new Set(changes.resetFields.filter(isSettingField)))
    : [];
}

async function resetFieldsForDraft(env: RuntimeEnv, draftId: string): Promise<SettingField[]> {
  if (!env.DB) return [];
  try {
    const row = await env.DB.prepare("SELECT reset_fields_json FROM portal_settings_draft_resets WHERE draft_id = ?")
      .bind(draftId).first<{ reset_fields_json: string }>();
    const parsed = row ? JSON.parse(row.reset_fields_json) as unknown : [];
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter(isSettingField))) : [];
  } catch {
    return [];
  }
}

async function acquireSourceMutationLock(env: RuntimeEnv): Promise<string | null> {
  if (!env.DB) return "no-database";
  await env.DB.prepare(createSourceMutationLockTable).run();
  const now = Date.now();
  await env.DB.prepare("DELETE FROM portal_settings_source_lock WHERE id = ? AND acquired_at < ?")
    .bind("main", now - 60_000).run();
  const owner = crypto.randomUUID();
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO portal_settings_source_lock (id, owner, acquired_at) VALUES (?, ?, ?)")
    .bind("main", owner, now).run();
  return resultChanges(inserted) === 1 ? owner : null;
}

async function releaseSourceMutationLock(env: RuntimeEnv, owner: string): Promise<void> {
  if (!env.DB || owner === "no-database") return;
  await env.DB.prepare("DELETE FROM portal_settings_source_lock WHERE id = ? AND owner = ?")
    .bind("main", owner).run();
}

async function withSourceMutationLock(env: RuntimeEnv, operation: () => Promise<Response>): Promise<Response> {
  const owner = await acquireSourceMutationLock(env);
  if (!owner) return json({ error: "Другая операция уже изменяет источники настроек", code: "settings_source_busy" }, 409);
  try { return await operation(); }
  finally { await releaseSourceMutationLock(env, owner); }
}

function resolvedResetMaterial(
  changesValue: string,
  secretsValue: Record<string, unknown>,
  resets: SettingField[],
  env: RuntimeEnv,
): { changes: Record<string, unknown>; secrets: Record<string, unknown>; changed: boolean } {
  const parsedChanges = JSON.parse(changesValue || "{}") as unknown;
  const changes = { ...(objectValue(parsedChanges) ?? {}) };
  const secrets = {
    ...(typeof secretsValue.ipaPassword === "string" ? { ipaPassword: secretsValue.ipaPassword } : {}),
    ...(typeof secretsValue.xyopsApiKey === "string" ? { xyopsApiKey: secretsValue.xyopsApiKey } : {}),
  } as Record<string, unknown>;
  const beforeChanges = JSON.stringify(changes);
  const beforeSecrets = JSON.stringify(secrets);

  for (const field of resets) {
    const value = environmentValue(field, env);
    if (field === "ipaPassword") {
      delete changes.clearIpaPassword;
      delete secrets.ipaPassword;
      if (configuredEnv(value)) secrets.ipaPassword = String(value);
      else changes.clearIpaPassword = true;
    } else if (field === "xyopsApiKey") {
      delete changes.clearXyopsApiKey;
      delete secrets.xyopsApiKey;
      if (configuredEnv(value)) secrets.xyopsApiKey = String(value);
      else changes.clearXyopsApiKey = true;
    } else {
      changes[field] = value;
    }
  }

  return {
    changes,
    secrets,
    changed: beforeChanges !== JSON.stringify(changes) || beforeSecrets !== JSON.stringify(secrets),
  };
}

async function refreshResetFallbacks(
  env: RuntimeEnv,
  draftId: string,
  action: "validate" | "apply",
): Promise<Response | null> {
  if (!env.DB) return null;
  const resets = await resetFieldsForDraft(env, draftId);
  if (!resets.length) return null;
  const row = await env.DB.prepare("SELECT changes_json, encrypted_secrets, status, updated_at FROM portal_settings_drafts WHERE id = ?")
    .bind(draftId).first<DraftRow>();
  if (!row) return null;
  const secrets = await decryptJson(String(row.encrypted_secrets ?? ""), env.CONFIG_ENCRYPTION_KEY);
  const resolved = resolvedResetMaterial(String(row.changes_json ?? "{}"), secrets, resets, env);
  if (!resolved.changed) return null;

  const now = Date.now();
  const encryptedSecrets = await encryptJson(resolved.secrets, env.CONFIG_ENCRYPTION_KEY);
  const updated = await env.DB.prepare(`UPDATE portal_settings_drafts
    SET changes_json = ?, encrypted_secrets = ?, status = ?, validation_json = '{}', validated_at = NULL, updated_at = ?
    WHERE id = ? AND updated_at = ? AND status = ?`)
    .bind(JSON.stringify(resolved.changes), encryptedSecrets, "draft", now, draftId, Number(row.updated_at), String(row.status))
    .run();
  if (resultChanges(updated) !== 1) {
    return json({ error: "Черновик уже изменён другой операцией", code: "settings_draft_refresh_conflict" }, 409);
  }
  if (action === "apply") {
    return json({
      error: "ENV/default для reset-полей изменился после проверки. Выполните проверку черновика повторно.",
      code: "settings_reset_fallback_changed",
      draftId,
      resetFields: resets,
    }, 409);
  }
  return null;
}

async function normalizedRequest(request: Request): Promise<Request> {
  const url = new URL(request.url);
  const relevant = (request.method === "PUT" && url.pathname === "/api/integrations/settings")
    || (request.method === "POST" && url.pathname === "/api/integrations/settings/drafts");
  if (!relevant) return request;

  const body = await request.clone().json().catch(() => null) as unknown;
  const parsed = objectValue(body);
  if (!parsed) return request;
  const normalized = normalizeSettingsRequestBody(url.pathname, request.method, parsed);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(normalized),
  });
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const prepared = await normalizedRequest(request);
    const url = new URL(prepared.url);

    if (prepared.method === "POST" && url.pathname === "/api/integrations/settings/drafts") {
      const body = await prepared.clone().json().catch(() => null) as unknown;
      const resets = objectValue(body) ? resetFieldsFromBody(body as Record<string, unknown>) : [];
      if (resets.length) return withSourceMutationLock(sourceEnv, () => runtime.fetch(prepared, sourceEnv, ctx));
    }

    const lifecycleMatch = url.pathname.match(/^\/api\/integrations\/settings\/drafts\/([A-Za-z0-9-]{1,80})\/(validate|apply)$/);
    if (prepared.method === "POST" && lifecycleMatch) {
      const refreshed = await refreshResetFallbacks(sourceEnv, lifecycleMatch[1], lifecycleMatch[2] as "validate" | "apply");
      if (refreshed) return refreshed;
    }

    return runtime.fetch(prepared, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return runtime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
