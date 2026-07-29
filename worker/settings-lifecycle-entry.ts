import secureRuntime from "./secure-entry";

type RuntimeEnv = NonNullable<Parameters<typeof secureRuntime.fetch>[1]> & {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
};
type RuntimeContext = Parameters<typeof secureRuntime.fetch>[2];
type ScheduledController = Parameters<NonNullable<typeof secureRuntime.scheduled>>[0];

type PublicSettings = {
  source?: "database" | "environment";
  updatedAt?: number | null;
  demoMode?: boolean;
  freeipa?: { url?: string; username?: string; passwordConfigured?: boolean };
  xyops?: { url?: string; apiKeyConfigured?: boolean };
};

type DraftChanges = {
  demoMode?: boolean;
  ipaUrl?: string;
  ipaUsername?: string;
  xyopsUrl?: string;
  clearIpaPassword?: boolean;
  clearXyopsApiKey?: boolean;
};

type DraftSecrets = { ipaPassword?: string; xyopsApiKey?: string };
type StoredSecrets = { ipaPassword: string; xyopsApiKey: string };
type DraftStatus = "draft" | "validated" | "invalid" | "applying" | "conflict" | "applied" | "cancelled" | "rolled_back" | "rollback_conflict";

type DraftRow = {
  id: string;
  base_revision: number;
  changes_json: string;
  encrypted_secrets: string;
  status: DraftStatus;
  validation_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  validated_at: number | null;
  applied_at: number | null;
};

type ActiveRow = {
  config: Record<string, unknown>;
  configJson: string;
  encryptedSecrets: string;
  revision: number;
};

type AdminContext = { identity: string; permissions: string[] };
type ServiceName = "freeipa" | "xyops";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const createDraftsTable = `CREATE TABLE IF NOT EXISTS portal_settings_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  base_revision INTEGER NOT NULL,
  changes_json TEXT NOT NULL,
  encrypted_secrets TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  validated_at INTEGER,
  applied_at INTEGER
)`;
const createSettingsTable = "CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, encrypted_secrets TEXT NOT NULL, updated_at INTEGER NOT NULL)";
const createApplyCommitsTable = `CREATE TABLE IF NOT EXISTS portal_settings_apply_commits (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  encrypted_secrets TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function isLifecyclePath(pathname: string): boolean {
  return pathname === "/api/integrations/settings/effective"
    || pathname === "/api/integrations/settings/drafts"
    || pathname.startsWith("/api/integrations/settings/drafts/");
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
  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    bytes = Uint8Array.from(normalized.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  } else {
    try { bytes = base64ToBytes(normalized); }
    catch { throw new Error("CONFIG_ENCRYPTION_KEY must be 32-byte base64 or 64-character hex"); }
  }
  if (bytes.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptJson(value: Record<string, unknown>, keyValue?: string): Promise<string> {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptJson(value: string, keyValue?: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Unsupported encrypted settings format");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

async function encryptDraftSecrets(secrets: DraftSecrets, keyValue?: string): Promise<string> {
  return Object.keys(secrets).length ? encryptJson(secrets, keyValue) : "";
}

async function decryptDraftSecrets(value: string, keyValue?: string): Promise<DraftSecrets> {
  const parsed = await decryptJson(value, keyValue);
  return {
    ...(typeof parsed.ipaPassword === "string" ? { ipaPassword: parsed.ipaPassword } : {}),
    ...(typeof parsed.xyopsApiKey === "string" ? { xyopsApiKey: parsed.xyopsApiKey } : {}),
  };
}

function cleanUrl(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 2048) throw new Error(`${name} is too long`);
  let parsed: URL;
  try { parsed = new URL(trimmed); }
  catch { throw new Error(`${name} must be a valid HTTP(S) URL`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be a valid HTTP(S) URL without credentials`);
  }
  return parsed.href.replace(/\/$/, "");
}

function cleanString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} is too long`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name} contains control characters`);
  return normalized;
}

function normalizeDraftInput(body: Record<string, unknown>): { changes: DraftChanges; secrets: DraftSecrets } {
  const source = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes)
    ? body.changes as Record<string, unknown>
    : body;
  const allowed = new Set(["demoMode", "ipaUrl", "ipaUsername", "ipaPassword", "clearIpaPassword", "xyopsUrl", "xyopsApiKey", "clearXyopsApiKey", "baseRevision", "changes"]);
  for (const key of Object.keys(source)) if (!allowed.has(key)) throw new Error(`Unsupported setting: ${key}`);

  const changes: DraftChanges = {};
  const secrets: DraftSecrets = {};
  if (source.demoMode !== undefined) {
    if (typeof source.demoMode !== "boolean") throw new Error("demoMode must be boolean");
    changes.demoMode = source.demoMode;
  }
  if (source.ipaUrl !== undefined) changes.ipaUrl = cleanUrl(source.ipaUrl, "ipaUrl");
  if (source.ipaUsername !== undefined) changes.ipaUsername = cleanString(source.ipaUsername, "ipaUsername", 256);
  if (source.xyopsUrl !== undefined) changes.xyopsUrl = cleanUrl(source.xyopsUrl, "xyopsUrl");
  if (source.clearIpaPassword !== undefined) {
    if (typeof source.clearIpaPassword !== "boolean") throw new Error("clearIpaPassword must be boolean");
    changes.clearIpaPassword = source.clearIpaPassword;
  }
  if (source.clearXyopsApiKey !== undefined) {
    if (typeof source.clearXyopsApiKey !== "boolean") throw new Error("clearXyopsApiKey must be boolean");
    changes.clearXyopsApiKey = source.clearXyopsApiKey;
  }
  if (source.ipaPassword !== undefined) {
    if (typeof source.ipaPassword !== "string" || source.ipaPassword.length > 4096) throw new Error("ipaPassword must be a string up to 4096 characters");
    if (source.ipaPassword) secrets.ipaPassword = source.ipaPassword;
  }
  if (source.xyopsApiKey !== undefined) {
    if (typeof source.xyopsApiKey !== "string" || source.xyopsApiKey.length > 4096) throw new Error("xyopsApiKey must be a string up to 4096 characters");
    if (source.xyopsApiKey) secrets.xyopsApiKey = source.xyopsApiKey;
  }
  if (changes.clearIpaPassword && secrets.ipaPassword) throw new Error("ipaPassword and clearIpaPassword cannot be used together");
  if (changes.clearXyopsApiKey && secrets.xyopsApiKey) throw new Error("xyopsApiKey and clearXyopsApiKey cannot be used together");
  if (!Object.keys(changes).length && !Object.keys(secrets).length) throw new Error("Draft contains no changes");
  return { changes, secrets };
}

function resultChanges(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = result as { meta?: { changes?: number }; changes?: number };
  return Number(value.meta?.changes ?? value.changes ?? 0);
}

async function ensureTables(env: RuntimeEnv): Promise<void> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  await env.DB.prepare(createDraftsTable).run();
  await env.DB.prepare(createSettingsTable).run();
  await env.DB.prepare(createApplyCommitsTable).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_settings_drafts_updated_idx ON portal_settings_drafts(updated_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS portal_settings_apply_commits_created_idx ON portal_settings_apply_commits(created_at DESC)").run();
  const now = Date.now();
  await env.DB.prepare("DELETE FROM portal_settings_apply_commits WHERE created_at < ?").bind(now - 60 * 60 * 1000).run();
  await env.DB.prepare("DELETE FROM portal_settings_drafts WHERE status IN ('cancelled','applied','rolled_back','rollback_conflict','conflict') AND updated_at < ?").bind(now - 30 * 24 * 60 * 60 * 1000).run();
}

async function activeRow(env: RuntimeEnv): Promise<ActiveRow | null> {
  if (!env.DB) return null;
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

async function delegate(request: Request, env: RuntimeEnv, ctx: RuntimeContext, pathname: string, init?: RequestInit): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  return secureRuntime.fetch(new Request(url, { ...init, headers }), env, ctx);
}

async function adminContext(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<AdminContext | Response> {
  if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN is not configured on the server" }, 503);
  if (!await secretsMatch(request.headers.get("x-admin-token"), env.ADMIN_TOKEN)) return json({ error: "Administrator authorization required" }, 401);
  const response = await delegate(request, env, ctx, "/api/integrations/status", { method: "GET" });
  const payload = await response.json().catch(() => ({})) as { access?: { identity?: string; permissions?: unknown[] }; error?: string };
  if (!response.ok) return json({ error: payload.error || "Cannot resolve portal identity" }, response.status);
  const permissions = Array.isArray(payload.access?.permissions) ? payload.access!.permissions.map(String) : [];
  if (!permissions.includes("settings.manage")) return json({ error: "Недостаточно прав для выполнения операции", requiredPermission: "settings.manage" }, 403);
  const identity = String(payload.access?.identity ?? "service-admin@portal.local").slice(0, 160);
  return { identity, permissions };
}

async function publicActiveSettings(request: Request, env: RuntimeEnv, ctx: RuntimeContext): Promise<PublicSettings> {
  const response = await delegate(request, env, ctx, "/api/integrations/settings", { method: "GET" });
  const payload = await response.json().catch(() => ({})) as PublicSettings & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Settings API returned HTTP ${response.status}`);
  return payload;
}

function configuredEnv(value: unknown): boolean {
  return typeof value === "string" ? Boolean(value.trim()) : value !== undefined;
}

function sourceMetadata(active: PublicSettings, env: RuntimeEnv, row: ActiveRow | null) {
  const database = Boolean(row);
  const field = (value: unknown, envValue: unknown, envName: string) => ({
    value,
    source: database ? "database" : configuredEnv(envValue) ? "environment" : "default",
    envName,
    envConfigured: configuredEnv(envValue),
    overridden: database && configuredEnv(envValue),
  });
  const secret = (configured: boolean, envValue: unknown, envName: string) => ({
    configured,
    source: database ? "database" : configuredEnv(envValue) ? "environment" : "default",
    envName,
    envConfigured: configuredEnv(envValue),
    overridden: database && configuredEnv(envValue),
  });
  return {
    revision: Number(active.updatedAt ?? row?.revision ?? 0),
    fields: {
      demoMode: field(Boolean(active.demoMode), env.DEMO_MODE, "DEMO_MODE"),
      ipaUrl: field(String(active.freeipa?.url ?? ""), env.IPA_URL, "IPA_URL"),
      ipaUsername: field(String(active.freeipa?.username ?? ""), env.IPA_USERNAME, "IPA_USERNAME"),
      ipaPassword: secret(Boolean(active.freeipa?.passwordConfigured), env.IPA_PASSWORD, "IPA_PASSWORD"),
      xyopsUrl: field(String(active.xyops?.url ?? ""), env.XYOPS_URL, "XYOPS_URL"),
      xyopsApiKey: secret(Boolean(active.xyops?.apiKeyConfigured), env.XYOPS_API_KEY, "XYOPS_API_KEY"),
    },
  };
}

function safeDiff(active: PublicSettings, changes: DraftChanges, secrets: DraftSecrets) {
  const before: Record<string, unknown> = {
    demoMode: Boolean(active.demoMode),
    ipaUrl: String(active.freeipa?.url ?? ""),
    ipaUsername: String(active.freeipa?.username ?? ""),
    xyopsUrl: String(active.xyops?.url ?? ""),
  };
  const entries: Array<{ field: string; before: unknown; after: unknown; secret: boolean }> = [];
  for (const [field, after] of Object.entries(changes)) {
    if (field === "clearIpaPassword") {
      if (after === true) entries.push({ field: "ipaPassword", before: active.freeipa?.passwordConfigured ? "configured" : "not configured", after: "clear", secret: true });
      continue;
    }
    if (field === "clearXyopsApiKey") {
      if (after === true) entries.push({ field: "xyopsApiKey", before: active.xyops?.apiKeyConfigured ? "configured" : "not configured", after: "clear", secret: true });
      continue;
    }
    entries.push({ field, before: before[field], after, secret: false });
  }
  if (secrets.ipaPassword) entries.push({ field: "ipaPassword", before: active.freeipa?.passwordConfigured ? "configured" : "not configured", after: "replace", secret: true });
  if (secrets.xyopsApiKey) entries.push({ field: "xyopsApiKey", before: active.xyops?.apiKeyConfigured ? "configured" : "not configured", after: "replace", secret: true });
  return entries;
}

function publicDraft(row: DraftRow, active: PublicSettings, secrets: DraftSecrets) {
  const changes = JSON.parse(row.changes_json) as DraftChanges;
  const validation = JSON.parse(row.validation_json || "{}") as Record<string, unknown>;
  return {
    id: row.id,
    baseRevision: Number(row.base_revision),
    status: row.status,
    changes: {
      ...changes,
      ipaPasswordChanged: Boolean(secrets.ipaPassword),
      xyopsApiKeyChanged: Boolean(secrets.xyopsApiKey),
    },
    diff: safeDiff(active, changes, secrets),
    validation,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    validatedAt: row.validated_at == null ? null : Number(row.validated_at),
    appliedAt: row.applied_at == null ? null : Number(row.applied_at),
  };
}

async function readDraft(env: RuntimeEnv, id: string): Promise<DraftRow | null> {
  await ensureTables(env);
  return env.DB!.prepare("SELECT id, base_revision, changes_json, encrypted_secrets, status, validation_json, created_by, created_at, updated_at, validated_at, applied_at FROM portal_settings_drafts WHERE id = ?")
    .bind(id).first<DraftRow>();
}

function uniqueServices(values: ServiceName[]): ServiceName[] {
  return Array.from(new Set(values));
}

function requestedServices(value: unknown, active: PublicSettings, changes: DraftChanges, secrets: DraftSecrets): ServiceName[] {
  const result: ServiceName[] = Array.isArray(value)
    ? value.filter((item): item is ServiceName => item === "freeipa" || item === "xyops")
    : [];
  if (changes.ipaUrl !== undefined || changes.ipaUsername !== undefined || changes.clearIpaPassword !== undefined || secrets.ipaPassword) result.push("freeipa");
  if (changes.xyopsUrl !== undefined || changes.clearXyopsApiKey !== undefined || secrets.xyopsApiKey) result.push("xyops");

  if (active.demoMode === true && changes.demoMode === false) {
    const ipaUrl = changes.ipaUrl ?? String(active.freeipa?.url ?? "");
    const ipaUsername = changes.ipaUsername ?? String(active.freeipa?.username ?? "");
    const ipaPasswordConfigured = changes.clearIpaPassword === true ? false : Boolean(secrets.ipaPassword || active.freeipa?.passwordConfigured);
    const xyopsUrl = changes.xyopsUrl ?? String(active.xyops?.url ?? "");
    const xyopsApiKeyConfigured = changes.clearXyopsApiKey === true ? false : Boolean(secrets.xyopsApiKey || active.xyops?.apiKeyConfigured);
    if (ipaUrl || ipaUsername || ipaPasswordConfigured) result.push("freeipa");
    if (xyopsUrl || xyopsApiKeyConfigured) result.push("xyops");
  }
  return uniqueServices(result);
}

async function validateDraft(request: Request, env: RuntimeEnv, ctx: RuntimeContext, row: DraftRow, servicesValue: unknown): Promise<Response> {
  if (!["draft", "invalid", "validated"].includes(row.status)) return json({ error: "Draft can no longer be validated", code: "settings_draft_inactive" }, 409);
  const active = await publicActiveSettings(request, env, ctx);
  const currentRevision = Number(active.updatedAt ?? 0);
  if (currentRevision !== Number(row.base_revision)) {
    await env.DB!.prepare("UPDATE portal_settings_drafts SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('applied','cancelled')")
      .bind("conflict", Date.now(), row.id).run();
    return json({ error: "Active settings changed after this draft was created", code: "settings_revision_conflict", currentRevision, baseRevision: Number(row.base_revision) }, 409);
  }
  const changes = JSON.parse(row.changes_json) as DraftChanges;
  const secrets = await decryptDraftSecrets(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
  const services = requestedServices(servicesValue, active, changes, secrets);
  const payload: Record<string, unknown> = { ...changes, ...secrets };
  const checks: Array<{ service: string; ok: boolean; latencyMs?: number; error?: string }> = [];
  for (const service of services) {
    const response = await delegate(request, env, ctx, "/api/integrations/settings/test", {
      method: "POST",
      body: JSON.stringify({ ...payload, service }),
    });
    const result = await response.json().catch(() => ({})) as { latencyMs?: number; error?: string };
    checks.push(response.ok
      ? { service, ok: true, latencyMs: Number(result.latencyMs ?? 0) }
      : { service, ok: false, error: String(result.error ?? `HTTP ${response.status}`).slice(0, 500) });
  }
  const now = Date.now();
  const ok = checks.every((check) => check.ok);
  const validation = { ok, checkedAt: now, revision: currentRevision, services: checks };
  await env.DB!.prepare("UPDATE portal_settings_drafts SET status = ?, validation_json = ?, validated_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft','invalid','validated')")
    .bind(ok ? "validated" : "invalid", JSON.stringify(validation), now, now, row.id).run();
  const updated = await readDraft(env, row.id);
  if (!updated) return json({ error: "Draft disappeared during validation" }, 500);
  return json({ draft: publicDraft(updated, active, secrets) }, ok ? 200 : 422);
}

async function currentStoredSecrets(env: RuntimeEnv, row: ActiveRow | null): Promise<StoredSecrets> {
  if (!row) return { ipaPassword: env.IPA_PASSWORD ?? "", xyopsApiKey: env.XYOPS_API_KEY ?? "" };
  const parsed = await decryptJson(row.encryptedSecrets, env.CONFIG_ENCRYPTION_KEY);
  return { ipaPassword: String(parsed.ipaPassword ?? ""), xyopsApiKey: String(parsed.xyopsApiKey ?? "") };
}

async function commitDraft(env: RuntimeEnv, row: DraftRow, changes: DraftChanges, secrets: DraftSecrets): Promise<{ commitId: string; revision: number; settings: PublicSettings } | null> {
  const current = await activeRow(env);
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== Number(row.base_revision)) return null;
  const currentSecrets = await currentStoredSecrets(env, current);
  const config: Record<string, unknown> = current ? { ...current.config } : {
    demoMode: ["true", "1", "yes", "on"].includes(String(env.DEMO_MODE ?? "").toLowerCase()),
    ipaUrl: env.IPA_URL ?? "",
    ipaUsername: env.IPA_USERNAME ?? "",
    xyopsUrl: env.XYOPS_URL ?? "",
  };
  if (changes.demoMode !== undefined) config.demoMode = changes.demoMode;
  if (changes.ipaUrl !== undefined) config.ipaUrl = changes.ipaUrl;
  if (changes.ipaUsername !== undefined) config.ipaUsername = changes.ipaUsername;
  if (changes.xyopsUrl !== undefined) config.xyopsUrl = changes.xyopsUrl;
  const nextSecrets: StoredSecrets = {
    ipaPassword: changes.clearIpaPassword === true ? "" : secrets.ipaPassword ?? currentSecrets.ipaPassword,
    xyopsApiKey: changes.clearXyopsApiKey === true ? "" : secrets.xyopsApiKey ?? currentSecrets.xyopsApiKey,
  };
  const revision = Math.max(Date.now(), currentRevision + 1);
  const configJson = JSON.stringify(config);
  const encryptedSecrets = await encryptJson(nextSecrets, env.CONFIG_ENCRYPTION_KEY);
  const commitId = crypto.randomUUID();
  const writeStatement = current
    ? env.DB!.prepare("UPDATE app_settings SET config_json = ?, encrypted_secrets = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
      .bind(configJson, encryptedSecrets, revision, "main", currentRevision)
    : env.DB!.prepare("INSERT OR IGNORE INTO app_settings (id, config_json, encrypted_secrets, updated_at) VALUES (?, ?, ?, ?)")
      .bind("main", configJson, encryptedSecrets, revision);
  const commitStatement = env.DB!.prepare(`INSERT INTO portal_settings_apply_commits
    (id, draft_id, revision, config_json, encrypted_secrets, created_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM app_settings
      WHERE id = ? AND updated_at = ? AND config_json = ? AND encrypted_secrets = ?
    )`)
    .bind(commitId, row.id, revision, configJson, encryptedSecrets, Date.now(), "main", revision, configJson, encryptedSecrets);
  const [write, commit] = await env.DB!.batch([writeStatement, commitStatement]);
  if (resultChanges(write) !== 1 || resultChanges(commit) !== 1) return null;
  return {
    commitId,
    revision,
    settings: {
      source: "database",
      updatedAt: revision,
      demoMode: config.demoMode === true,
      freeipa: { url: String(config.ipaUrl ?? ""), username: String(config.ipaUsername ?? ""), passwordConfigured: Boolean(nextSecrets.ipaPassword) },
      xyops: { url: String(config.xyopsUrl ?? ""), apiKeyConfigured: Boolean(nextSecrets.xyopsApiKey) },
    },
  };
}

async function applyDraft(env: RuntimeEnv, row: DraftRow): Promise<Response> {
  if (row.status !== "validated") return json({ error: "Draft must be validated before apply", code: "settings_draft_not_validated" }, 409);
  const claimed = await env.DB!.prepare("UPDATE portal_settings_drafts SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
    .bind("applying", Date.now(), row.id, "validated").run();
  if (resultChanges(claimed) !== 1) return json({ error: "Draft is already being changed", code: "settings_draft_busy" }, 409);

  try {
    const changes = JSON.parse(row.changes_json) as DraftChanges;
    const secrets = await decryptDraftSecrets(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
    const committed = await commitDraft(env, row, changes, secrets);
    if (!committed) {
      const current = await activeRow(env);
      await env.DB!.prepare("UPDATE portal_settings_drafts SET status = ?, updated_at = ? WHERE id = ?")
        .bind("conflict", Date.now(), row.id).run();
      return json({ error: "Active settings changed after validation", code: "settings_revision_conflict", currentRevision: current?.revision ?? 0, baseRevision: Number(row.base_revision) }, 409);
    }
    const now = Date.now();
    await env.DB!.prepare("UPDATE portal_settings_drafts SET status = ?, applied_at = ?, updated_at = ? WHERE id = ?")
      .bind("applied", now, now, row.id).run();
    const validation = JSON.parse(row.validation_json || "{}") as { services?: Array<{ service?: string }> };
    const services = Array.isArray(validation.services)
      ? validation.services.map((item) => item.service).filter((item): item is ServiceName => item === "freeipa" || item === "xyops")
      : [];
    return json({ ok: true, settings: committed.settings, revision: committed.revision, services, applyCommitId: committed.commitId });
  } catch (error) {
    await env.DB!.prepare("UPDATE portal_settings_drafts SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
      .bind("validated", Date.now(), row.id, "applying").run();
    throw error;
  }
}

async function cancelDraft(request: Request, env: RuntimeEnv, ctx: RuntimeContext, row: DraftRow): Promise<Response> {
  const now = Date.now();
  const cancelled = await env.DB!.prepare("UPDATE portal_settings_drafts SET status = ?, encrypted_secrets = '', updated_at = ? WHERE id = ? AND status IN ('draft','validated','invalid')")
    .bind("cancelled", now, row.id).run();
  if (resultChanges(cancelled) !== 1) return json({ error: "Draft can no longer be cancelled", code: "settings_draft_inactive" }, 409);
  const [updated, active] = await Promise.all([readDraft(env, row.id), publicActiveSettings(request, env, ctx)]);
  if (!updated) return json({ error: "Settings draft not found" }, 404);
  return json({ draft: publicDraft(updated, active, {}) });
}

async function handleLifecycle(request: Request, env: RuntimeEnv, ctx: RuntimeContext, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: "Persistent database is unavailable" }, 503);
  const access = await adminContext(request, env, ctx);
  if (access instanceof Response) return access;
  await ensureTables(env);

  if (request.method === "GET" && url.pathname === "/api/integrations/settings/effective") {
    try {
      const [active, row] = await Promise.all([publicActiveSettings(request, env, ctx), activeRow(env)]);
      return json({ settings: active, ...sourceMetadata(active, env, row) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot read effective settings" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/integrations/settings/drafts") {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return json({ error: "Invalid JSON" }, 400); }
    try {
      const [active, row] = await Promise.all([publicActiveSettings(request, env, ctx), activeRow(env)]);
      const currentRevision = Number(active.updatedAt ?? row?.revision ?? 0);
      const requestedRevision = body.baseRevision === undefined ? currentRevision : Number(body.baseRevision);
      if (!Number.isFinite(requestedRevision) || requestedRevision !== currentRevision) {
        return json({ error: "Active settings revision does not match", code: "settings_revision_conflict", currentRevision, requestedRevision }, 409);
      }
      const { changes, secrets } = normalizeDraftInput(body);
      const encryptedSecrets = await encryptDraftSecrets(secrets, env.CONFIG_ENCRYPTION_KEY);
      const id = crypto.randomUUID();
      const now = Date.now();
      await env.DB!.prepare("INSERT INTO portal_settings_drafts (id, base_revision, changes_json, encrypted_secrets, status, validation_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, currentRevision, JSON.stringify(changes), encryptedSecrets, "draft", "{}", access.identity, now, now).run();
      const created = await readDraft(env, id);
      if (!created) throw new Error("Draft was not persisted");
      return json({ draft: publicDraft(created, active, secrets), source: sourceMetadata(active, env, row) }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot create settings draft" }, 400);
    }
  }

  const match = url.pathname.match(/^\/api\/integrations\/settings\/drafts\/([A-Za-z0-9-]{1,80})(?:\/(validate|apply|cancel))?$/);
  if (!match) return json({ error: "Not found" }, 404);
  const row = await readDraft(env, match[1]);
  if (!row) return json({ error: "Settings draft not found" }, 404);
  const action = match[2] ?? "";

  if (!action && request.method === "GET") {
    try {
      const active = await publicActiveSettings(request, env, ctx);
      const secrets = await decryptDraftSecrets(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
      return json({ draft: publicDraft(row, active, secrets) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot read settings draft" }, 500);
    }
  }
  if (action === "validate" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    try { return await validateDraft(request, env, ctx, row, body.services); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot validate settings draft" }, 400); }
  }
  if (action === "apply" && request.method === "POST") {
    try { return await applyDraft(env, row); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot apply settings draft" }, 400); }
  }
  if (action === "cancel" && request.method === "POST") {
    try { return await cancelDraft(request, env, ctx, row); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot cancel settings draft" }, 400); }
  }
  return json({ error: "Method not allowed" }, 405);
}

const worker = {
  async fetch(request: Request, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as RuntimeEnv);
    const url = new URL(request.url);
    if (isLifecyclePath(url.pathname)) return handleLifecycle(request, sourceEnv, ctx, url);
    return secureRuntime.fetch(request, sourceEnv, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv | undefined, ctx: RuntimeContext): Promise<void> {
    return secureRuntime.scheduled?.(controller, env, ctx);
  },
};

export default worker;
