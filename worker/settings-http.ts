import { appendAuditEvent, auditErrorCode, createAuditContext } from "../audit-log";
import { serviceAdminTokenAuthorized } from "../src/auth/admin-session-authorization.ts";
import { decryptIntegrationSecrets } from "./integration-settings-runtime.ts";
import { freeIpaRpc, type FreeIpaRpcEnv } from "./freeipa-rpc.ts";
import { portalAccess, requirePortalPermission, type PortalAccessEnv } from "./portal-access-runtime.ts";
import { xyopsPayloadSucceeded } from "./xyops-run-runtime.ts";

export type SettingsHttpEnv = PortalAccessEnv & FreeIpaRpcEnv & {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
};

type StoredSecrets = {
  ipaPassword: string;
  xyopsApiKey: string;
};

type ActiveSettings = {
  config: {
    demoMode: boolean;
    ipaUrl: string;
    ipaUsername: string;
    xyopsUrl: string;
  };
  secrets: StoredSecrets;
  updatedAt: number;
};

type SettingsRow = {
  config_json: string;
  encrypted_secrets: string;
  updated_at: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function cleanBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function settingString(value: unknown, name: string, maxLength = 2048): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} is too long`);
  return normalized;
}

function environmentSettings(env: SettingsHttpEnv): ActiveSettings {
  return {
    config: {
      demoMode: boolValue(env.DEMO_MODE),
      ipaUrl: cleanBaseUrl(env.IPA_URL),
      ipaUsername: env.IPA_USERNAME ?? "",
      xyopsUrl: cleanBaseUrl(env.XYOPS_URL),
    },
    secrets: {
      ipaPassword: env.IPA_PASSWORD ?? "",
      xyopsApiKey: env.XYOPS_API_KEY ?? "",
    },
    updatedAt: 0,
  };
}

function assertStoredRoutesReadable(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  if (raw.length > 100) throw new Error("routes must be an array with at most 100 items");
  const keys = new Set<string>();
  const allowedOperations = new Set([
    "user_add", "user_mod", "user_password", "user_enable", "user_disable",
    "user_del", "group_add", "group_del", "group_add_member", "group_remove_member",
  ]);
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`routes[${index}] must be an object`);
    const source = item as Record<string, unknown>;
    const key = String(source.key ?? "").trim().slice(0, 120);
    const title = String(source.title ?? "").trim().slice(0, 240);
    const operation = String(source.operation ?? "");
    const kind = source.kind === "workflow" ? "workflow" : source.kind === "event" ? "event" : null;
    const eventId = String(source.eventId ?? "").trim().slice(0, 240);
    if (!key || keys.has(key) || !title || !eventId || !kind || !allowedOperations.has(operation)) {
      throw new Error(`routes[${index}] is invalid or duplicated`);
    }
    keys.add(key);
  }
}

async function activeSettings(env: SettingsHttpEnv): Promise<{ settings: ActiveSettings; source: "database" | "environment" }> {
  if (!env.DB) return { settings: environmentSettings(env), source: "environment" };
  const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?")
    .bind("main")
    .first<SettingsRow>();
  if (!row) return { settings: environmentSettings(env), source: "environment" };
  const parsed = JSON.parse(String(row.config_json ?? "{}")) as unknown;
  const config = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  assertStoredRoutesReadable(config.routes);
  const secrets = await decryptIntegrationSecrets(String(row.encrypted_secrets ?? ""), env.CONFIG_ENCRYPTION_KEY);
  return {
    settings: {
      config: {
        demoMode: config.demoMode === true,
        ipaUrl: String(config.ipaUrl ?? ""),
        ipaUsername: String(config.ipaUsername ?? ""),
        xyopsUrl: String(config.xyopsUrl ?? ""),
      },
      secrets,
      updatedAt: Number(row.updated_at ?? 0),
    },
    source: "database",
  };
}

function publicSettings(settings: ActiveSettings, env: SettingsHttpEnv, source: "database" | "environment") {
  return {
    source,
    persistenceAvailable: Boolean(env.DB),
    encryptionConfigured: Boolean(env.CONFIG_ENCRYPTION_KEY),
    updatedAt: settings.updatedAt || null,
    demoMode: settings.config.demoMode,
    freeipa: {
      url: settings.config.ipaUrl,
      username: settings.config.ipaUsername,
      passwordConfigured: Boolean(settings.secrets.ipaPassword),
    },
    xyops: {
      url: settings.config.xyopsUrl,
      apiKeyConfigured: Boolean(settings.secrets.xyopsApiKey),
    },
  };
}

function mergeConnectionTestInput(current: ActiveSettings, body: Record<string, unknown>): ActiveSettings {
  const ipaUrlInput = body.ipaUrl === undefined ? current.config.ipaUrl : settingString(body.ipaUrl, "ipaUrl");
  const xyopsUrlInput = body.xyopsUrl === undefined ? current.config.xyopsUrl : settingString(body.xyopsUrl, "xyopsUrl");
  const ipaUrl = ipaUrlInput ? cleanBaseUrl(ipaUrlInput) : "";
  const xyopsUrl = xyopsUrlInput ? cleanBaseUrl(xyopsUrlInput) : "";
  if (ipaUrlInput && !ipaUrl) throw new Error("ipaUrl must be a valid HTTP(S) URL without credentials");
  if (xyopsUrlInput && !xyopsUrl) throw new Error("xyopsUrl must be a valid HTTP(S) URL without credentials");
  const ipaPassword = body.clearIpaPassword === true
    ? ""
    : typeof body.ipaPassword === "string" && body.ipaPassword
      ? body.ipaPassword.slice(0, 4096)
      : current.secrets.ipaPassword;
  const xyopsApiKey = body.clearXyopsApiKey === true
    ? ""
    : typeof body.xyopsApiKey === "string" && body.xyopsApiKey
      ? body.xyopsApiKey.slice(0, 4096)
      : current.secrets.xyopsApiKey;
  return {
    config: {
      demoMode: body.demoMode === undefined ? current.config.demoMode : body.demoMode === true,
      ipaUrl,
      ipaUsername: body.ipaUsername === undefined
        ? current.config.ipaUsername
        : settingString(body.ipaUsername, "ipaUsername", 256),
      xyopsUrl,
    },
    secrets: { ipaPassword, xyopsApiKey },
    updatedAt: Date.now(),
  };
}

async function authorize(request: Request, env: SettingsHttpEnv): Promise<Response | null> {
  const denied = requirePortalPermission(request, env, "settings.manage");
  if (denied) return denied;
  if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN is not configured on the server" }, 503);
  if (!await serviceAdminTokenAuthorized(request, env.ADMIN_TOKEN)) {
    return json({ error: "Administrator authorization required" }, 401);
  }
  return null;
}

/**
 * Owns the extracted settings read/connection-test HTTP surface after the
 * established identity normalization in secure-entry.ts.
 *
 * Returning null means the request is outside this checkpoint's ownership and
 * must continue to the downstream compatibility runtime (notably direct PUT).
 */
export async function handleSettingsHttpRequest(request: Request, env: SettingsHttpEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const settingsRead = request.method === "GET" && url.pathname === "/api/integrations/settings";
  const settingsTestPath = url.pathname === "/api/integrations/settings/test";
  if (!settingsRead && !settingsTestPath) return null;

  const denied = await authorize(request, env);
  if (denied) return denied;

  if (settingsRead) {
    try {
      const { settings, source } = await activeSettings(env);
      return json(publicSettings(settings, env, source));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot read settings" }, 500);
    }
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const audit = createAuditContext(portalAccess(request, env));
  try {
    const { settings: current } = await activeSettings(env);
    const draft = mergeConnectionTestInput(current, body);
    const service = body.service === "freeipa" ? "freeipa" : body.service === "xyops" ? "xyops" : null;
    if (!service) return json({ error: "service must be freeipa or xyops" }, 400);

    const started = Date.now();
    if (service === "freeipa") {
      if (!draft.config.ipaUrl || !draft.config.ipaUsername || !draft.secrets.ipaPassword) {
        return json({ error: "FreeIPA settings are incomplete" }, 400);
      }
      await freeIpaRpc(
        { ...env, IPA_USERNAME: draft.config.ipaUsername, IPA_PASSWORD: draft.secrets.ipaPassword },
        draft.config.ipaUrl,
        "user_find",
        [""],
        { sizelimit: 1 },
      );
    } else {
      if (!draft.config.xyopsUrl || !draft.secrets.xyopsApiKey) return json({ error: "XYOps settings are incomplete" }, 400);
      const response = await fetch(`${draft.config.xyopsUrl}/api/app/get_events/v1`, {
        method: "GET",
        headers: { "x-api-key": draft.secrets.xyopsApiKey, accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !xyopsPayloadSucceeded(payload)) throw new Error("XYOps rejected the connection test");
    }

    const latencyMs = Date.now() - started;
    await appendAuditEvent(env, audit, {
      action: "settings.connection_test",
      resourceType: "integration",
      resourceId: service,
      outcome: "success",
      metadata: { service, latencyMs },
    }).catch(() => {});
    return json({ ok: true, service, latencyMs });
  } catch (error) {
    await appendAuditEvent(env, audit, {
      action: "settings.connection_test",
      resourceType: "integration",
      resourceId: String(body.service ?? "unknown"),
      outcome: "failure",
      errorCode: auditErrorCode(error, "connection_test_failed"),
    }).catch(() => {});
    return json({ error: error instanceof Error ? error.message : "Connection test failed" }, 502);
  }
}
