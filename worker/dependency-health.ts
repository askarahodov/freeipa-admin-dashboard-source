import type { PortalSchemaStatus } from "../db/portal-migrations-hardened.ts";
import { migrationCapableDatabase } from "./schema-migrations-boundary.ts";

type DependencyName = "freeipa" | "xyops";
type DependencyState = "healthy" | "degraded" | "unconfigured";
type DependencyCategory =
  | "ok"
  | "configuration"
  | "dns"
  | "tls"
  | "timeout"
  | "authentication"
  | "rate_limited"
  | "upstream"
  | "protocol"
  | "network"
  | "disabled";

type DependencyResult = {
  name: DependencyName;
  state: DependencyState;
  category: DependencyCategory;
  code: string;
  latencyMs: number | null;
  lastSuccessAt: number | null;
};

type DependencyConfiguration = {
  demoMode: boolean;
  updatedAt: number;
  freeipa: { url: string; username: string; password: string };
  xyops: { url: string; apiKey: string };
  gateway: { url: string; token: string };
};

type DependencyHealthEnv = {
  DB?: unknown;
  IPA_URL?: string;
  IPA_USERNAME?: string;
  IPA_PASSWORD?: string;
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
  XYOPS_URL?: string;
  XYOPS_API_KEY?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string;
  PORTAL_BUILD_VERSION?: string;
};

type DependencyHealthDependencies = {
  portalSchema: (env: DependencyHealthEnv) => Promise<PortalSchemaStatus>;
  loadConfiguration?: (env: DependencyHealthEnv) => Promise<DependencyConfiguration>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
};

type SafeProbeSnapshot = {
  observedAt: number;
  dependencies: DependencyResult[];
};

type StoredSettingsRow = {
  config_json: string;
  encrypted_secrets: string;
  updated_at: number;
};

type D1LikeDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

const dependencyPath = "/health/dependencies";
const serviceName = "freeipa-admin-dashboard";
const contractVersion = "1";
const defaultCacheTtlMs = 30_000;
const maximumCacheTtlMs = 300_000;
const probeTimeoutMs = 8_000;
const maximumJsonBytes = 64 * 1024;
const knownGatewayCodes = new Set([
  "freeipa_dns_failed",
  "freeipa_tls_failed",
  "freeipa_timeout",
  "freeipa_auth_rejected",
  "freeipa_protocol_failed",
  "freeipa_unavailable",
]);

let cachedSnapshot: SafeProbeSnapshot | null = null;
let inFlightProbe: Promise<SafeProbeSnapshot> | null = null;

export function resetDependencyHealthCacheForTests(): void {
  cachedSnapshot = null;
  inFlightProbe = null;
}

function jsonResponse(status: number, payload: Record<string, unknown>, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });
}

function safeBuildVersion(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && /^[A-Za-z0-9._+/-]+$/.test(normalized)
    ? normalized
    : "unknown";
}

function numericVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeTtl(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximumCacheTtlMs, Math.trunc(value)))
    : defaultCacheTtlMs;
}

function healthPayload(input: {
  env: DependencyHealthEnv;
  schema: PortalSchemaStatus;
  snapshot: SafeProbeSnapshot;
  source: "fresh" | "cache";
  ageMs: number;
  ttlMs: number;
}): Record<string, unknown> {
  const healthy = input.snapshot.dependencies.every((item) => item.state === "healthy");
  return {
    contractVersion,
    service: serviceName,
    check: "dependencies",
    state: healthy ? "healthy" : "degraded",
    code: healthy ? "dependencies_healthy" : "dependencies_degraded",
    ok: healthy,
    metadata: {
      buildVersion: safeBuildVersion(input.env.PORTAL_BUILD_VERSION),
      schemaVersion: numericVersion(input.schema.currentVersion),
      latestSchemaVersion: numericVersion(input.schema.latestVersion),
      observedAt: input.snapshot.observedAt,
      cache: {
        source: input.source,
        ageMs: Math.max(0, Math.trunc(input.ageMs)),
        ttlMs: input.ttlMs,
      },
    },
    dependencies: input.snapshot.dependencies,
  };
}

function unavailablePayload(
  env: DependencyHealthEnv,
  code: string,
  schema?: PortalSchemaStatus,
): Record<string, unknown> {
  return {
    contractVersion,
    service: serviceName,
    check: "dependencies",
    state: "unready",
    code,
    ok: false,
    metadata: {
      buildVersion: safeBuildVersion(env.PORTAL_BUILD_VERSION),
      schemaVersion: numericVersion(schema?.currentVersion),
      latestSchemaVersion: numericVersion(schema?.latestVersion),
      observedAt: null,
      cache: { source: "none", ageMs: 0, ttlMs: defaultCacheTtlMs },
    },
    dependencies: [],
  };
}

function boolValue(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function cleanUrl(value: unknown, options: { loopbackOnly?: boolean } = {}): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) return "";
    if (options.loopbackOnly) {
      if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) return "";
    }
    parsed.hash = "";
    parsed.search = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function environmentConfiguration(env: DependencyHealthEnv): DependencyConfiguration {
  return {
    demoMode: boolValue(env.DEMO_MODE),
    updatedAt: 0,
    freeipa: {
      url: cleanUrl(env.IPA_URL),
      username: String(env.IPA_USERNAME ?? "").trim(),
      password: String(env.IPA_PASSWORD ?? ""),
    },
    xyops: {
      url: cleanUrl(env.XYOPS_URL),
      apiKey: String(env.XYOPS_API_KEY ?? ""),
    },
    gateway: {
      url: cleanUrl(env.IPA_NODE_GATEWAY_URL, { loopbackOnly: true }),
      token: String(env.IPA_NODE_GATEWAY_TOKEN ?? "").trim(),
    },
  };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(value: unknown): Promise<CryptoKey> {
  if (typeof value !== "string" || !value.trim()) throw new Error("settings encryption unavailable");
  const normalized = value.trim();
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    bytes = Uint8Array.from(normalized.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  } else {
    bytes = base64ToBytes(normalized);
  }
  if (bytes.byteLength !== 32) throw new Error("settings encryption unavailable");
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
}

async function decryptStoredSecrets(value: unknown, keyValue: unknown): Promise<{ ipaPassword: string; xyopsApiKey: string }> {
  if (typeof value !== "string") throw new Error("settings payload unavailable");
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("settings payload unavailable");
  const key = await encryptionKey(keyValue);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivValue) },
    key,
    base64ToBytes(encryptedValue),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
  return {
    ipaPassword: String(parsed.ipaPassword ?? ""),
    xyopsApiKey: String(parsed.xyopsApiKey ?? ""),
  };
}

async function storedConfiguration(env: DependencyHealthEnv): Promise<DependencyConfiguration> {
  const fallback = environmentConfiguration(env);
  const database = env.DB as D1LikeDatabase;
  const row = await database
    .prepare("SELECT config_json, encrypted_secrets, updated_at FROM app_settings WHERE id = ?")
    .bind("main")
    .first<StoredSettingsRow>();
  if (!row) return fallback;

  const parsed = JSON.parse(row.config_json) as Record<string, unknown>;
  const secrets = await decryptStoredSecrets(row.encrypted_secrets, env.CONFIG_ENCRYPTION_KEY);
  return {
    demoMode: parsed.demoMode === true,
    updatedAt: Number.isFinite(Number(row.updated_at)) ? Number(row.updated_at) : 0,
    freeipa: {
      url: cleanUrl(parsed.ipaUrl),
      username: String(parsed.ipaUsername ?? "").trim(),
      password: secrets.ipaPassword,
    },
    xyops: {
      url: cleanUrl(parsed.xyopsUrl),
      apiKey: secrets.xyopsApiKey,
    },
    gateway: fallback.gateway,
  };
}

function gatewayRpcUrl(value: string): string {
  const base = cleanUrl(value, { loopbackOnly: true });
  return base ? `${base}/rpc` : "";
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumJsonBytes) return null;
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumJsonBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function timeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const cause = "cause" in error && error.cause && typeof error.cause === "object" ? error.cause : null;
  const code = cause && "code" in cause ? String(cause.code) : "code" in error ? String(error.code) : "";
  return name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT";
}

function previousSuccess(previous: SafeProbeSnapshot | null, name: DependencyName): number | null {
  return previous?.dependencies.find((item) => item.name === name)?.lastSuccessAt ?? null;
}

function result(input: Omit<DependencyResult, "lastSuccessAt">, previous: SafeProbeSnapshot | null, observedAt: number): DependencyResult {
  return {
    ...input,
    lastSuccessAt: input.state === "healthy" ? observedAt : previousSuccess(previous, input.name),
  };
}

function freeIpaCategory(code: unknown): { category: DependencyCategory; code: string } {
  const safeCode = typeof code === "string" && knownGatewayCodes.has(code) ? code : "freeipa_protocol_failed";
  switch (safeCode) {
    case "freeipa_dns_failed": return { category: "dns", code: safeCode };
    case "freeipa_tls_failed": return { category: "tls", code: safeCode };
    case "freeipa_timeout": return { category: "timeout", code: safeCode };
    case "freeipa_auth_rejected": return { category: "authentication", code: safeCode };
    case "freeipa_unavailable": return { category: "network", code: safeCode };
    default: return { category: "protocol", code: "freeipa_protocol_failed" };
  }
}

async function probeFreeIpa(input: {
  configuration: DependencyConfiguration;
  fetchImpl: typeof fetch;
  now: () => number;
  observedAt: number;
  previous: SafeProbeSnapshot | null;
}): Promise<DependencyResult> {
  const { freeipa, gateway } = input.configuration;
  const rpcUrl = gatewayRpcUrl(gateway.url);
  if (!freeipa.url || !freeipa.username || !freeipa.password || !rpcUrl || !gateway.token) {
    return result({
      name: "freeipa",
      state: "unconfigured",
      category: "configuration",
      code: "freeipa_not_configured",
      latencyMs: null,
    }, input.previous, input.observedAt);
  }

  const startedAt = input.now();
  try {
    const response = await input.fetchImpl(rpcUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${gateway.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        ipaUrl: freeipa.url,
        username: freeipa.username,
        password: freeipa.password,
        method: "user_find",
        args: [""],
        options: { sizelimit: 1 },
      }),
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    const latencyMs = Math.max(0, Math.trunc(input.now() - startedAt));
    const payload = await boundedJson(response);
    if (response.ok && payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).result)) {
      return result({ name: "freeipa", state: "healthy", category: "ok", code: "freeipa_ready", latencyMs }, input.previous, input.observedAt);
    }
    const classified = freeIpaCategory(payload && typeof payload === "object" ? (payload as Record<string, unknown>).code : null);
    return result({ name: "freeipa", state: "degraded", category: classified.category, code: classified.code, latencyMs }, input.previous, input.observedAt);
  } catch (error) {
    const latencyMs = Math.max(0, Math.trunc(input.now() - startedAt));
    return result({
      name: "freeipa",
      state: "degraded",
      category: timeoutError(error) ? "timeout" : "network",
      code: timeoutError(error) ? "freeipa_timeout" : "freeipa_unavailable",
      latencyMs,
    }, input.previous, input.observedAt);
  }
}

function xyopsStatus(status: number): { category: DependencyCategory; code: string } {
  if (status === 401 || status === 403) return { category: "authentication", code: "xyops_auth_rejected" };
  if (status === 429) return { category: "rate_limited", code: "xyops_rate_limited" };
  if (status >= 500) return { category: "upstream", code: "xyops_upstream_failed" };
  return { category: "protocol", code: "xyops_protocol_failed" };
}

async function probeXyOps(input: {
  configuration: DependencyConfiguration;
  fetchImpl: typeof fetch;
  now: () => number;
  observedAt: number;
  previous: SafeProbeSnapshot | null;
}): Promise<DependencyResult> {
  const { xyops } = input.configuration;
  if (input.configuration.demoMode && (!xyops.url || !xyops.apiKey)) {
    return result({ name: "xyops", state: "healthy", category: "disabled", code: "xyops_demo_mode", latencyMs: null }, input.previous, input.observedAt);
  }
  if (!xyops.url || !xyops.apiKey) {
    return result({ name: "xyops", state: "unconfigured", category: "configuration", code: "xyops_not_configured", latencyMs: null }, input.previous, input.observedAt);
  }

  const startedAt = input.now();
  try {
    const response = await input.fetchImpl(`${xyops.url}/api/app/get_events/v1`, {
      method: "GET",
      redirect: "manual",
      headers: { "x-api-key": xyops.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    const latencyMs = Math.max(0, Math.trunc(input.now() - startedAt));
    if (!response.ok) {
      await boundedJson(response);
      const classified = xyopsStatus(response.status);
      return result({ name: "xyops", state: "degraded", category: classified.category, code: classified.code, latencyMs }, input.previous, input.observedAt);
    }
    const payload = await boundedJson(response);
    if (!payload || typeof payload !== "object") {
      return result({ name: "xyops", state: "degraded", category: "protocol", code: "xyops_protocol_failed", latencyMs }, input.previous, input.observedAt);
    }
    const applicationCode = (payload as Record<string, unknown>).code;
    if (typeof applicationCode === "number" && applicationCode !== 0) {
      return result({ name: "xyops", state: "degraded", category: "protocol", code: "xyops_protocol_failed", latencyMs }, input.previous, input.observedAt);
    }
    return result({ name: "xyops", state: "healthy", category: "ok", code: "xyops_ready", latencyMs }, input.previous, input.observedAt);
  } catch (error) {
    const latencyMs = Math.max(0, Math.trunc(input.now() - startedAt));
    return result({
      name: "xyops",
      state: "degraded",
      category: timeoutError(error) ? "timeout" : "network",
      code: timeoutError(error) ? "xyops_timeout" : "xyops_unavailable",
      latencyMs,
    }, input.previous, input.observedAt);
  }
}

async function freshSnapshot(input: {
  configuration: DependencyConfiguration;
  fetchImpl: typeof fetch;
  now: () => number;
  previous: SafeProbeSnapshot | null;
}): Promise<SafeProbeSnapshot> {
  const observedAt = input.now();
  const [freeipa, xyops] = await Promise.all([
    probeFreeIpa({ ...input, observedAt }),
    probeXyOps({ ...input, observedAt }),
  ]);
  return { observedAt, dependencies: [freeipa, xyops] };
}

export async function handleDependencyHealthRequest(
  request: Request,
  env: DependencyHealthEnv,
  dependencies: DependencyHealthDependencies,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== dependencyPath) return null;
  if (request.method !== "GET") {
    return jsonResponse(405, { ok: false, code: "dependency_method_not_allowed" }, { allow: "GET" });
  }
  if (!migrationCapableDatabase(env.DB)) {
    return jsonResponse(503, unavailablePayload(env, "dependency_database_unavailable"));
  }

  let schema: PortalSchemaStatus;
  try {
    schema = await dependencies.portalSchema(env);
  } catch {
    return jsonResponse(503, unavailablePayload(env, "dependency_schema_unready"));
  }
  if (schema.state !== "ready") {
    return jsonResponse(503, unavailablePayload(env, "dependency_schema_unready", schema));
  }

  let configuration: DependencyConfiguration;
  try {
    configuration = dependencies.loadConfiguration
      ? await dependencies.loadConfiguration(env)
      : await storedConfiguration(env);
  } catch {
    return jsonResponse(503, unavailablePayload(env, "dependency_configuration_unavailable", schema));
  }

  const now = dependencies.now ?? Date.now;
  const ttlMs = safeTtl(dependencies.cacheTtlMs);
  const currentTime = now();
  if (cachedSnapshot && currentTime - cachedSnapshot.observedAt < ttlMs) {
    return jsonResponse(200, healthPayload({
      env,
      schema,
      snapshot: cachedSnapshot,
      source: "cache",
      ageMs: currentTime - cachedSnapshot.observedAt,
      ttlMs,
    }));
  }

  if (!inFlightProbe) {
    const previous = cachedSnapshot;
    inFlightProbe = freshSnapshot({
      configuration,
      fetchImpl: dependencies.fetchImpl ?? fetch,
      now,
      previous,
    }).then((snapshot) => {
      cachedSnapshot = snapshot;
      return snapshot;
    }).finally(() => {
      inFlightProbe = null;
    });
  }

  const snapshot = await inFlightProbe;
  return jsonResponse(200, healthPayload({ env, schema, snapshot, source: "fresh", ageMs: 0, ttlMs }));
}
