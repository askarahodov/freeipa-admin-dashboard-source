import lifecycleRuntime from "./settings-lifecycle-entry";
import { appendAuditEvent, createAuditContext } from "../audit-log";

type RuntimeEnv = NonNullable<Parameters<typeof lifecycleRuntime.fetch>[1]> & {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
};
type RuntimeContext = Parameters<typeof lifecycleRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof lifecycleRuntime.scheduled>>[0];

type SettingField = "demoMode" | "ipaUrl" | "ipaUsername" | "ipaPassword" | "xyopsUrl" | "xyopsApiKey";
type ServiceName = "freeipa" | "xyops";

type ActiveRow = {
  config: Record<string, unknown>;
  configJson: string;
  encryptedSecrets: string;
  revision: number;
};

type DraftRow = {
  id: string;
  changes_json: string;
  encrypted_secrets: string;
  created_by: string;
};

type StoredSecrets = { ipaPassword: string; xyopsApiKey: string };

const settingFields: SettingField[] = ["demoMode", "ipaUrl", "ipaUsername", "ipaPassword", "xyopsUrl", "xyopsApiKey"];
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function isSettingField(value: unknown): value is SettingField {
  return settingFields.includes(value as SettingField);
}

function uniqueFields(values: SettingField[]): SettingField[] {
  return Array.from(new Set(values));
}

function resultChanges(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = result as { meta?: { changes?: number }; changes?: number };
  return Number(value.meta?.changes ?? value.changes ?? 0);
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

function environmentName(field: SettingField): string {
  if (field === "demoMode") return "DEMO_MODE";
  if (field === "ipaUrl") return "IPA_URL";
  if (field === "ipaUsername") return "IPA_USERNAME";
  if (field === "ipaPassword") return "IPA_PASSWORD";
  if (field === "xyopsUrl") return "XYOPS_URL";
  return "XYOPS_API_KEY";
}

function environmentConfigured(field: SettingField, env: RuntimeEnv): boolean {
  if (field === "demoMode") return env.DEMO_MODE !== undefined;
  return configuredEnv(environmentValue(field, env));
}

function overrideSet(config: Record<string, unknown> | null | undefined): Set<SettingField> {
  if (!config) return new Set();
  if (!Object.prototype.hasOwnProperty.call(config, "overrides")) return new Set(settingFields);
  return new Set(Array.isArray(config.overrides) ? config.overrides.filter(isSettingField) : []);
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

async function encryptSecrets(secrets: StoredSecrets, keyValue?: string): Promise<string> {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(secrets)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptObject(value: string, keyValue?: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Unsupported encrypted settings format");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

async function storedSecrets(env: RuntimeEnv, row: ActiveRow): Promise<StoredSecrets> {
  const parsed = await decryptObject(row.encryptedSecrets, env.CONFIG_ENCRYPTION_KEY);
  return { ipaPassword: String(parsed.ipaPassword ?? ""), xyopsApiKey: String(parsed.xyopsApiKey ?? "") };
}

async function acquireSourceMutationLock(env: RuntimeEnv): Promise<string | null> {
  if (!env.DB) return "no-database";
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

async function activeRow(env: RuntimeEnv): Promise<ActiveRow | null> {
  if (!env.DB) return null;
  await env.DB.prepare(createSettingsTable).run();
  const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?")
    .bind("main").first<{ config_json: string; encrypted_secrets: string; updated_at: number }>();
  if (!row) return null;
  const parsed = JSON.parse(String(row.config_json ?? "{}")) as unknown;
  return {
    config: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {},
    configJson: String(row.config_json ?? "{}"),
    encryptedSecrets: String(row.encrypted_secrets ?? ""),
    revision: Number(row.updated_at ?? 0),
  };
}

async function readDraft(env: RuntimeEnv, id: string): Promise<DraftRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare("SELECT id, changes_json, encrypted_secrets, created_by FROM portal_settings_drafts WHERE id = ?")
    .bind(id).first<DraftRow>();
}

async function readResetFields(env: RuntimeEnv, draftId: string): Promise<SettingField[]> {
  if (!env.DB) return [];
  const row = await env.DB.prepare("SELECT reset_fields_json FROM portal_settings_draft_resets WHERE draft_id = ?")
    .bind(draftId).first<{ reset_fields_json: string }>();
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.reset_fields_json) as unknown;
    return Array.isArray(parsed) ? uniqueFields(parsed.filter(isSettingField)) : [];
  } catch {
    return [];
  }
}

async function saveResetFields(env: RuntimeEnv, draftId: string, fields: SettingField[]): Promise<void> {
  if (!env.DB || !fields.length) return;
  await env.DB.prepare("INSERT INTO portal_settings_draft_resets (draft_id, reset_fields_json, created_at) VALUES (?, ?, ?) ON CONFLICT(draft_id) DO UPDATE SET reset_fields_json = excluded.reset_fields_json, created_at = excluded.created_at")
    .bind(draftId, JSON.stringify(fields), Date.now()).run();
}

async function deleteResetFields(env: RuntimeEnv, draftId: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM portal_settings_draft_resets WHERE draft_id = ?").bind(draftId).run();
}

async function delegate(request: Request, env: RuntimeEnv, ctx: RuntimeContext, body?: unknown): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  if (body === undefined) return lifecycleRuntime.fetch(new Request(request, { headers }), env, ctx);
  headers.set("content-type", "application/json");
  return lifecycleRuntime.fetch(new Request(request.url, { method: request.method, headers, body: JSON.stringify(body) }), env, ctx);
}

async function synchronizeInheritedSettingsUnlocked(env: RuntimeEnv): Promise<void> {
  if (!env.DB || !env.CONFIG_ENCRYPTION_KEY) return;
  const row = await activeRow(env);
  if (!row) return;
  const overrides = overrideSet(row.config);
  if (overrides.size === settingFields.length) return;

  const secrets = await storedSecrets(env, row);
  const nextConfig = { ...row.config, overrides: settingFields.filter((field) => overrides.has(field)) };
  const nextSecrets = { ...secrets };
  for (const field of settingFields) {
    if (overrides.has(field)) continue;
    const value = environmentValue(field, env);
    if (field === "ipaPassword") nextSecrets.ipaPassword = configuredEnv(value) ? String(value) : "";
    else if (field === "xyopsApiKey") nextSecrets.xyopsApiKey = configuredEnv(value) ? String(value) : "";
    else nextConfig[field] = value;
  }

  const configJson = JSON.stringify(nextConfig);
  const secretChanged = nextSecrets.ipaPassword !== secrets.ipaPassword || nextSecrets.xyopsApiKey !== secrets.xyopsApiKey;
  if (configJson === row.configJson && !secretChanged) return;
  const encryptedSecrets = await encryptSecrets(nextSecrets, env.CONFIG_ENCRYPTION_KEY);
  const revision = Math.max(Date.now(), row.revision + 1);
  await env.DB.prepare("UPDATE app_settings SET config_json = ?, encrypted_secrets = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
    .bind(configJson, encryptedSecrets, revision, "main", row.revision).run();
}

async function trySynchronizeInheritedSettings(env: RuntimeEnv): Promise<void> {
  if (!env.DB) return;
  const owner = await acquireSourceMutationLock(env);
  if (!owner) return;
  try { await synchronizeInheritedSettingsUnlocked(env); }
  finally { await releaseSourceMutationLock(env, owner); }
}

function parseResetFields(body: Record<string, unknown>): SettingField[] {
  const changes = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes)
    ? body.changes as Record<string, unknown>
    : body;
  if (changes.resetFields === undefined) return [];
  if (!Array.isArray(changes.resetFields)) throw new Error("resetFields must be an array");
  return uniqueFields(changes.resetFields.map((value) => {
    if (!isSettingField(value)) throw new Error(`Unsupported reset field: ${String(value)}`);
    return value;
  }));
}

function resetConflicts(body: Record<string, unknown>, resetFields: SettingField[]): SettingField[] {
  const changes = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes)
    ? body.changes as Record<string, unknown>
    : body;
  const resets = new Set(resetFields);
  const conflicts: SettingField[] = [];
  if (changes.demoMode !== undefined && resets.has("demoMode")) conflicts.push("demoMode");
  if (changes.ipaUrl !== undefined && resets.has("ipaUrl")) conflicts.push("ipaUrl");
  if (changes.ipaUsername !== undefined && resets.has("ipaUsername")) conflicts.push("ipaUsername");
  if ((changes.ipaPassword !== undefined || changes.clearIpaPassword !== undefined) && resets.has("ipaPassword")) conflicts.push("ipaPassword");
  if (changes.xyopsUrl !== undefined && resets.has("xyopsUrl")) conflicts.push("xyopsUrl");
  if ((changes.xyopsApiKey !== undefined || changes.clearXyopsApiKey !== undefined) && resets.has("xyopsApiKey")) conflicts.push("xyopsApiKey");
  return uniqueFields(conflicts);
}

function transformedDraftBody(body: Record<string, unknown>, resetFields: SettingField[], env: RuntimeEnv): Record<string, unknown> {
  if (!resetFields.length) return body;
  const nested = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes);
  const changes = { ...(nested ? body.changes as Record<string, unknown> : body) };
  delete changes.resetFields;
  for (const field of resetFields) {
    const value = environmentValue(field, env);
    if (field === "ipaPassword") {
      delete changes.clearIpaPassword;
      if (configuredEnv(value)) changes.ipaPassword = String(value);
      else { delete changes.ipaPassword; changes.clearIpaPassword = true; }
    } else if (field === "xyopsApiKey") {
      delete changes.clearXyopsApiKey;
      if (configuredEnv(value)) changes.xyopsApiKey = String(value);
      else { delete changes.xyopsApiKey; changes.clearXyopsApiKey = true; }
    } else {
      changes[field] = value;
    }
  }
  return nested ? { ...body, changes } : { ...changes, baseRevision: body.baseRevision };
}

function patchEffectivePayload(payload: Record<string, unknown>, row: ActiveRow | null, env: RuntimeEnv): Record<string, unknown> {
  const overrides = overrideSet(row?.config);
  const fields = payload.fields && typeof payload.fields === "object" && !Array.isArray(payload.fields)
    ? { ...payload.fields as Record<string, Record<string, unknown>> }
    : {};
  let conflicts = 0;
  for (const field of settingFields) {
    const current = { ...(fields[field] ?? {}) };
    const database = overrides.has(field);
    const envConfigured = environmentConfigured(field, env);
    if (database && envConfigured) conflicts += 1;
    fields[field] = {
      ...current,
      source: database ? "database" : envConfigured ? "environment" : "default",
      envName: environmentName(field),
      envConfigured,
      overridden: database && envConfigured,
      resettable: database,
      fallbackSource: envConfigured ? "environment" : "default",
    };
  }
  return { ...payload, fields, overrideCount: overrides.size, conflictCount: conflicts };
}

function resetDiffEntry(field: SettingField, existing: Record<string, unknown> | undefined, env: RuntimeEnv) {
  const source = environmentConfigured(field, env) ? "environment" : "default";
  if (field === "ipaPassword" || field === "xyopsApiKey") {
    return {
      field,
      before: existing?.before ?? "configured",
      after: source === "environment" ? "ENV configured" : "DEFAULT not configured",
      secret: true,
      reset: true,
      source,
    };
  }
  return { field, before: existing?.before, after: environmentValue(field, env), secret: false, reset: true, source };
}

function patchDraftPayload(payload: Record<string, unknown>, resetFields: SettingField[], env: RuntimeEnv): Record<string, unknown> {
  if (!resetFields.length || !payload.draft || typeof payload.draft !== "object" || Array.isArray(payload.draft)) return payload;
  const draft = { ...payload.draft as Record<string, unknown> };
  const changes = draft.changes && typeof draft.changes === "object" && !Array.isArray(draft.changes)
    ? { ...draft.changes as Record<string, unknown>, resetFields }
    : { resetFields };
  const resetSet = new Set(resetFields);
  const original = Array.isArray(draft.diff)
    ? draft.diff.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    : [];
  const byField = new Map(original.map((entry) => [String(entry.field), entry]));
  const diff = original.filter((entry) => !resetSet.has(String(entry.field) as SettingField));
  draft.changes = changes;
  draft.diff = [...resetFields.map((field) => resetDiffEntry(field, byField.get(field), env)), ...diff];
  return { ...payload, draft };
}

function disabledResetServices(resetFields: SettingField[], env: RuntimeEnv): Set<ServiceName> {
  const result = new Set<ServiceName>();
  if (resetFields.some((field) => ["ipaUrl", "ipaUsername", "ipaPassword"].includes(field) && !environmentConfigured(field, env))) result.add("freeipa");
  if (resetFields.some((field) => ["xyopsUrl", "xyopsApiKey"].includes(field) && !environmentConfigured(field, env))) result.add("xyops");
  return result;
}

async function promoteIntentionalDisableValidation(
  env: RuntimeEnv,
  draftId: string,
  resetFields: SettingField[],
  response: Response,
  payload: Record<string, unknown>,
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  if (response.status !== 422 || !env.DB) return { response, payload };
  const disabled = disabledResetServices(resetFields, env);
  if (!disabled.size || !payload.draft || typeof payload.draft !== "object" || Array.isArray(payload.draft)) return { response, payload };
  const draft = { ...payload.draft as Record<string, unknown> };
  const validation = draft.validation && typeof draft.validation === "object" && !Array.isArray(draft.validation)
    ? { ...draft.validation as Record<string, unknown> }
    : {};
  const checks = Array.isArray(validation.services)
    ? validation.services.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
  const failures = checks.filter((check) => check.ok === false);
  if (!failures.length || failures.some((check) => !disabled.has(String(check.service) as ServiceName))) return { response, payload };
  const services = checks.filter((check) => !disabled.has(String(check.service) as ServiceName));
  const now = Date.now();
  const promotedValidation = { ...validation, ok: true, checkedAt: now, services, skippedServices: Array.from(disabled) };
  const update = await env.DB.prepare("UPDATE portal_settings_drafts SET status = ?, validation_json = ?, validated_at = ?, updated_at = ? WHERE id = ? AND status = ?")
    .bind("validated", JSON.stringify(promotedValidation), now, now, draftId, "invalid").run();
  if (resultChanges(update) !== 1) return { response, payload };
  draft.status = "validated";
  draft.validation = promotedValidation;
  return { response: json({ ...payload, draft }, 200), payload: { ...payload, draft } };
}

function draftChangedFields(row: DraftRow, resetFields: SettingField[]): SettingField[] {
  const resetSet = new Set(resetFields);
  const result: SettingField[] = [];
  let changes: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.changes_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) changes = parsed as Record<string, unknown>;
  } catch {}
  for (const field of ["demoMode", "ipaUrl", "ipaUsername", "xyopsUrl"] as SettingField[]) {
    if (changes[field] !== undefined && !resetSet.has(field)) result.push(field);
  }
  if (changes.clearIpaPassword === true && !resetSet.has("ipaPassword")) result.push("ipaPassword");
  if (changes.clearXyopsApiKey === true && !resetSet.has("xyopsApiKey")) result.push("xyopsApiKey");
  return uniqueFields(result);
}

async function draftSecretFields(env: RuntimeEnv, row: DraftRow, resetFields: SettingField[]): Promise<SettingField[]> {
  if (!row.encrypted_secrets) return [];
  const resetSet = new Set(resetFields);
  const parsed = await decryptObject(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
  const result: SettingField[] = [];
  if (typeof parsed.ipaPassword === "string" && !resetSet.has("ipaPassword")) result.push("ipaPassword");
  if (typeof parsed.xyopsApiKey === "string" && !resetSet.has("xyopsApiKey")) result.push("xyopsApiKey");
  return result;
}

async function desiredOverrides(env: RuntimeEnv, row: DraftRow, before: ActiveRow | null, resets: SettingField[]): Promise<Set<SettingField>> {
  const result = overrideSet(before?.config);
  for (const field of resets) result.delete(field);
  for (const field of draftChangedFields(row, resets)) result.add(field);
  for (const field of await draftSecretFields(env, row, resets)) result.add(field);
  return result;
}

async function attachOverridesToAppliedRevision(env: RuntimeEnv, revision: number, commitId: string, overrides: Set<SettingField>): Promise<boolean> {
  if (!env.DB) return false;
  const row = await env.DB.prepare("SELECT config_json FROM app_settings WHERE id = ? AND updated_at = ?")
    .bind("main", revision).first<{ config_json: string }>();
  const commit = await env.DB.prepare("SELECT config_json FROM portal_settings_apply_commits WHERE id = ? AND revision = ?")
    .bind(commitId, revision).first<{ config_json: string }>();
  if (!row || !commit) return false;
  const parsed = JSON.parse(row.config_json) as Record<string, unknown>;
  const configJson = JSON.stringify({ ...parsed, overrides: settingFields.filter((field) => overrides.has(field)) });
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE app_settings SET config_json = ? WHERE id = ? AND updated_at = ?").bind(configJson, "main", revision),
    env.DB.prepare("UPDATE portal_settings_apply_commits SET config_json = ? WHERE id = ? AND revision = ?").bind(configJson, commitId, revision),
  ]);
  return resultChanges(results[0]) === 1 && resultChanges(results[1]) === 1;
}

async function attachOverridesToActiveRevision(env: RuntimeEnv, revision: number, overrides: Set<SettingField>): Promise<boolean> {
  if (!env.DB) return false;
  const row = await env.DB.prepare("SELECT config_json FROM app_settings WHERE id = ? AND updated_at = ?")
    .bind("main", revision).first<{ config_json: string }>();
  if (!row) return false;
  const parsed = JSON.parse(row.config_json) as Record<string, unknown>;
  const configJson = JSON.stringify({ ...parsed, overrides: settingFields.filter((field) => overrides.has(field)) });
  const update = await env.DB.prepare("UPDATE app_settings SET config_json = ? WHERE id = ? AND updated_at = ?")
    .bind(configJson, "main", revision).run();
  return resultChanges(update) === 1;
}

async function restoreActiveSnapshotCas(env: RuntimeEnv, before: ActiveRow | null, attemptedRevision: number): Promise<boolean> {
  if (!env.DB) return false;
  if (!before) {
    const removed = await env.DB.prepare("DELETE FROM app_settings WHERE id = ? AND updated_at = ?")
      .bind("main", attemptedRevision).run();
    return resultChanges(removed) === 1;
  }
  const rollbackRevision = Math.max(Date.now(), attemptedRevision + 1);
  const restored = await env.DB.prepare("UPDATE app_settings SET config_json = ?, encrypted_secrets = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
    .bind(before.configJson, before.encryptedSecrets, rollbackRevision, "main", attemptedRevision).run();
  return resultChanges(restored) === 1;
}

function directSettingsOverrides(body: Record<string, unknown>, before: ActiveRow | null): Set<SettingField> {
  const result = overrideSet(before?.config);
  if (body.demoMode !== undefined) result.add("demoMode");
  if (body.ipaUrl !== undefined) result.add("ipaUrl");
  if (body.ipaUsername !== undefined) result.add("ipaUsername");
  if (body.ipaPassword !== undefined || body.clearIpaPassword !== undefined) result.add("ipaPassword");
  if (body.xyopsUrl !== undefined) result.add("xyopsUrl");
  if (body.xyopsApiKey !== undefined || body.clearXyopsApiKey !== undefined) result.add("xyopsApiKey");
  return result;
}

function audit(identity: string) {
  return createAuditContext({ identity, role: "admin", groups: [] });
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.clone().json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function responseWithPayload(payload: Record<string, unknown>, response: Response): Response {
  return json(payload, response.status);
}

function conflictPayload(payload: Record<string, unknown>): boolean {
  const draft = payload.draft && typeof payload.draft === "object" && !Array.isArray(payload.draft) ? payload.draft as Record<string, unknown> : {};
  return payload.code === "settings_revision_conflict" || draft.status === "conflict";
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);
    if (url.pathname === "/api/integrations/health") return lifecycleRuntime.fetch(request, sourceEnv, ctx);
    if (url.pathname.startsWith("/api/integrations/") && url.pathname !== "/api/integrations/settings/test") {
      await trySynchronizeInheritedSettings(sourceEnv).catch(() => {});
    }

    if (request.method === "GET" && url.pathname === "/api/integrations/settings/effective") {
      const response = await delegate(request, sourceEnv, ctx);
      if (!response.ok) return response;
      const [payload, row] = await Promise.all([responsePayload(response), activeRow(sourceEnv)]);
      return responseWithPayload(patchEffectivePayload(payload, row, sourceEnv), response);
    }

    if (request.method === "PUT" && url.pathname === "/api/integrations/settings") {
      let body: Record<string, unknown>;
      try { body = await request.clone().json() as Record<string, unknown>; }
      catch { return delegate(request, sourceEnv, ctx); }
      return withSourceMutationLock(sourceEnv, async () => {
        const before = await activeRow(sourceEnv);
        const response = await delegate(request, sourceEnv, ctx);
        if (!response.ok) return response;
        const payload = await responsePayload(response);
        const revision = Number(payload.updatedAt ?? 0);
        const attached = revision > 0 && await attachOverridesToActiveRevision(sourceEnv, revision, directSettingsOverrides(body, before));
        if (attached) return response;
        const rolledBack = revision > 0 && await restoreActiveSnapshotCas(sourceEnv, before, revision);
        return json({ error: "Не удалось атомарно сохранить metadata источников", code: rolledBack ? "settings_source_commit_failed" : "settings_source_rollback_conflict", rolledBack }, rolledBack ? 500 : 409);
      });
    }

    if (request.method === "PUT" && url.pathname === "/api/integrations/routes") {
      return withSourceMutationLock(sourceEnv, async () => {
        const before = await activeRow(sourceEnv);
        const response = await lifecycleRuntime.fetch(request, sourceEnv, ctx);
        if (!response.ok) return response;
        const after = await activeRow(sourceEnv);
        const revision = Number(after?.revision ?? 0);
        const attached = revision > 0 && await attachOverridesToActiveRevision(sourceEnv, revision, overrideSet(before?.config));
        if (attached) return response;
        const rolledBack = revision > 0 && await restoreActiveSnapshotCas(sourceEnv, before, revision);
        return json({ error: "Не удалось атомарно сохранить routes и metadata источников", code: rolledBack ? "settings_source_commit_failed" : "settings_source_rollback_conflict", rolledBack }, rolledBack ? 500 : 409);
      });
    }

    if (request.method === "POST" && url.pathname === "/api/integrations/settings/drafts") {
      let body: Record<string, unknown>;
      try { body = await request.clone().json() as Record<string, unknown>; }
      catch { return delegate(request, sourceEnv, ctx); }
      let resets: SettingField[];
      try { resets = parseResetFields(body); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid reset fields" }, 400); }
      const conflicts = resetConflicts(body, resets);
      if (conflicts.length) return json({ error: `Fields cannot be changed and reset together: ${conflicts.join(", ")}`, code: "settings_reset_conflict", fields: conflicts }, 400);
      if (resets.length) {
        const current = await activeRow(sourceEnv);
        const overrides = overrideSet(current?.config);
        const invalid = resets.filter((field) => !overrides.has(field));
        if (invalid.length) return json({ error: `Fields are not overridden in D1: ${invalid.join(", ")}`, code: "settings_field_not_overridden", fields: invalid }, 409);
      }
      const response = await delegate(request, sourceEnv, ctx, transformedDraftBody(body, resets, sourceEnv));
      const payload = await responsePayload(response);
      const draft = payload.draft && typeof payload.draft === "object" ? payload.draft as Record<string, unknown> : {};
      const draftId = String(draft.id ?? "");
      if (response.ok && draftId && resets.length) {
        await saveResetFields(sourceEnv, draftId, resets);
        const identity = String(draft.createdBy ?? "portal-user").slice(0, 160);
        await appendAuditEvent(sourceEnv, audit(identity), {
          action: "settings.override.reset_requested",
          resourceType: "portal_settings_draft",
          resourceId: draftId,
          outcome: "pending",
          metadata: { fields: resets, baseRevision: Number(draft.baseRevision ?? 0) },
        }).catch(() => {});
      }
      return responseWithPayload(patchDraftPayload(payload, resets, sourceEnv), response);
    }

    const match = url.pathname.match(/^\/api\/integrations\/settings\/drafts\/([A-Za-z0-9-]{1,80})(?:\/(validate|apply|cancel))?$/);
    if (match) {
      const draftId = match[1];
      const action = match[2] ?? "";
      const resets = await readResetFields(sourceEnv, draftId);

      if (action === "apply" && request.method === "POST") {
        return withSourceMutationLock(sourceEnv, async () => {
          const [before, row] = await Promise.all([activeRow(sourceEnv), readDraft(sourceEnv, draftId)]);
          const overrides = row ? await desiredOverrides(sourceEnv, row, before, resets) : overrideSet(before?.config);
          const response = await delegate(request, sourceEnv, ctx);
          const payload = await responsePayload(response);
          if (!response.ok) {
            if (conflictPayload(payload)) await deleteResetFields(sourceEnv, draftId);
            return responseWithPayload(patchDraftPayload(payload, resets, sourceEnv), response);
          }
          const revision = Number(payload.revision ?? 0);
          const commitId = String(payload.applyCommitId ?? "");
          const attached = revision > 0 && commitId && await attachOverridesToAppliedRevision(sourceEnv, revision, commitId, overrides);
          await deleteResetFields(sourceEnv, draftId);
          return responseWithPayload({ ...payload, resetFields: resets, sourceMetadataConflict: !attached }, response);
        });
      }

      const response = await delegate(request, sourceEnv, ctx);
      let payload = await responsePayload(response);
      let effectiveResponse = response;
      if (action === "validate" && request.method === "POST" && resets.length) {
        const promoted = await promoteIntentionalDisableValidation(sourceEnv, draftId, resets, response, payload);
        effectiveResponse = promoted.response;
        payload = promoted.payload;
      }
      if ((action === "cancel" && effectiveResponse.ok) || conflictPayload(payload)) await deleteResetFields(sourceEnv, draftId);
      return responseWithPayload(patchDraftPayload(payload, resets, sourceEnv), effectiveResponse);
    }

    return lifecycleRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    await trySynchronizeInheritedSettings(sourceEnv).catch(() => {});
    return lifecycleRuntime.scheduled?.(controller, sourceEnv, ctx);
  },
};

export default worker;
