export type IntegrationSettingsSecrets = {
  ipaPassword: string;
  xyopsApiKey: string;
};

export type FreeIpaSettingsEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
};

export type XyOpsSettingsEnv = {
  DB?: D1Database;
  CONFIG_ENCRYPTION_KEY?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  XYOPS_RESULT_FILE_MAX_BYTES?: string;
};

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

export async function encryptIntegrationSecrets(secrets: IntegrationSettingsSecrets, keyValue?: string): Promise<string> {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(secrets)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptIntegrationSecrets(value: string, keyValue?: string): Promise<IntegrationSettingsSecrets> {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Unsupported encrypted settings format");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, key, base64ToBytes(encryptedValue));
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<IntegrationSettingsSecrets>;
  return { ipaPassword: String(parsed.ipaPassword ?? ""), xyopsApiKey: String(parsed.xyopsApiKey ?? "") };
}

export function cleanIntegrationBaseUrl(value?: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return null;
    return parsed.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function fallbackFreeIpaEnv<T extends FreeIpaSettingsEnv>(env: T): T {
  return {
    ...env,
    DEMO_MODE: boolValue(env.DEMO_MODE) ? "true" : "false",
    IPA_URL: cleanIntegrationBaseUrl(env.IPA_URL) ?? "",
    IPA_USERNAME: env.IPA_USERNAME ?? "",
    IPA_PASSWORD: env.IPA_PASSWORD ?? "",
  };
}

/**
 * Resolves only the FreeIPA slice of the persisted integration settings.
 *
 * This intentionally mirrors the legacy Worker precedence: a readable
 * app_settings row wins over environment values; missing/unreadable persisted
 * state falls back to the environment. Gateway credentials remain environment
 * only and are carried through unchanged.
 */
export async function effectiveFreeIpaRuntime<T extends FreeIpaSettingsEnv>(env: T): Promise<{ env: T; ipaUrl: string | null }> {
  const fallback = fallbackFreeIpaEnv(env);
  if (!env.DB) return { env: fallback, ipaUrl: cleanIntegrationBaseUrl(fallback.IPA_URL) };
  try {
    const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?")
      .bind("main")
      .first<{ config_json: string; encrypted_secrets: string; updated_at: number }>();
    if (!row) return { env: fallback, ipaUrl: cleanIntegrationBaseUrl(fallback.IPA_URL) };
    const config = JSON.parse(String(row.config_json ?? "{}")) as Record<string, unknown>;
    const secrets = await decryptIntegrationSecrets(String(row.encrypted_secrets ?? ""), env.CONFIG_ENCRYPTION_KEY);
    const effective = {
      ...env,
      DEMO_MODE: config.demoMode === true ? "true" : "false",
      IPA_URL: String(config.ipaUrl ?? ""),
      IPA_USERNAME: String(config.ipaUsername ?? ""),
      IPA_PASSWORD: secrets.ipaPassword,
    } as T;
    return { env: effective, ipaUrl: cleanIntegrationBaseUrl(effective.IPA_URL) };
  } catch {
    return { env: fallback, ipaUrl: cleanIntegrationBaseUrl(fallback.IPA_URL) };
  }
}

function fallbackXyOpsEnv<T extends XyOpsSettingsEnv>(env: T): T {
  return {
    ...env,
    XYOPS_URL: cleanIntegrationBaseUrl(env.XYOPS_URL) ?? "",
    XYOPS_API_KEY: env.XYOPS_API_KEY ?? "",
  };
}

/**
 * Resolves the persisted XYOps URL/API-key slice without importing the central
 * Worker settings owner. This mirrors the legacy effective-settings precedence:
 * readable persisted state wins, otherwise environment values are retained.
 */
export async function effectiveXyOpsRuntime<T extends XyOpsSettingsEnv>(env: T): Promise<{ env: T; xyopsUrl: string | null }> {
  const fallback = fallbackXyOpsEnv(env);
  if (!env.DB) return { env: fallback, xyopsUrl: cleanIntegrationBaseUrl(fallback.XYOPS_URL) };
  try {
    const row = await env.DB.prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?")
      .bind("main")
      .first<{ config_json: string; encrypted_secrets: string; updated_at: number }>();
    if (!row) return { env: fallback, xyopsUrl: cleanIntegrationBaseUrl(fallback.XYOPS_URL) };
    const config = JSON.parse(String(row.config_json ?? "{}")) as Record<string, unknown>;
    const secrets = await decryptIntegrationSecrets(String(row.encrypted_secrets ?? ""), env.CONFIG_ENCRYPTION_KEY);
    const effective = {
      ...env,
      XYOPS_URL: String(config.xyopsUrl ?? ""),
      XYOPS_API_KEY: secrets.xyopsApiKey,
    } as T;
    return { env: effective, xyopsUrl: cleanIntegrationBaseUrl(effective.XYOPS_URL) };
  } catch {
    return { env: fallback, xyopsUrl: cleanIntegrationBaseUrl(fallback.XYOPS_URL) };
  }
}
