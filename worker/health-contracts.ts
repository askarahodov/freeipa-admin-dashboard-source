import type { PortalSchemaStatus } from "../db/portal-migrations-hardened.ts";
import { migrationCapableDatabase } from "./schema-migrations-boundary.ts";

type HealthState = "healthy" | "unready";
type HealthCheckName = "database" | "schema" | "encryption" | "gateway";
type HealthCheck = {
  name: HealthCheckName;
  state: HealthState;
  code: string;
};

type HealthEnv = {
  DB?: unknown;
  CONFIG_ENCRYPTION_KEY?: string;
  IPA_NODE_GATEWAY_URL?: string;
  IPA_NODE_GATEWAY_TOKEN?: string;
  PORTAL_BUILD_VERSION?: string;
};

type HealthDependencies = {
  portalSchema: (env: HealthEnv) => Promise<PortalSchemaStatus>;
  fetchImpl?: typeof fetch;
};

type HealthMetadata = {
  buildVersion: string;
  schemaVersion: number | null;
  latestSchemaVersion: number | null;
};

const contractVersion = "1";
const serviceName = "freeipa-admin-dashboard";
const livePath = "/health/live";
const readyPath = "/health/ready";
const legacyPath = "/api/integrations/health";
const healthPaths = new Set([livePath, readyPath, legacyPath]);
const gatewayTimeoutMs = 1_500;

function boundedBuildVersion(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && /^[A-Za-z0-9._+/-]+$/.test(normalized)
    ? normalized
    : "unknown";
}

function numericVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function metadata(env: HealthEnv, schema?: PortalSchemaStatus): HealthMetadata {
  return {
    buildVersion: boundedBuildVersion(env.PORTAL_BUILD_VERSION),
    schemaVersion: numericVersion(schema?.currentVersion),
    latestSchemaVersion: numericVersion(schema?.latestVersion),
  };
}

function jsonResponse(
  status: number,
  payload: Record<string, unknown>,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    },
  });
}

function healthPayload(input: {
  check: "liveness" | "readiness";
  state: HealthState;
  code: string;
  metadata: HealthMetadata;
  checks: HealthCheck[];
}): Record<string, unknown> {
  return {
    contractVersion,
    service: serviceName,
    check: input.check,
    state: input.state,
    code: input.code,
    ok: input.state === "healthy",
    metadata: input.metadata,
    checks: input.checks,
  };
}

function livenessResponse(env: HealthEnv): Response {
  return jsonResponse(200, healthPayload({
    check: "liveness",
    state: "healthy",
    code: "health_live",
    metadata: metadata(env),
    checks: [],
  }));
}

function legacyLivenessResponse(): Response {
  return jsonResponse(
    200,
    { ok: true },
    {
      deprecation: "true",
      link: `<${livePath}>; rel="successor-version"`,
      warning: `299 - "Deprecated health endpoint; use ${livePath}"`,
    },
  );
}

function readinessFailure(
  env: HealthEnv,
  code: string,
  checks: HealthCheck[],
  schema?: PortalSchemaStatus,
): Response {
  return jsonResponse(503, healthPayload({
    check: "readiness",
    state: "unready",
    code,
    metadata: metadata(env, schema),
    checks,
  }));
}

function decodeEncryptionKey(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
  }
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9+/_=-]+$/.test(normalized)) return null;
  try {
    const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = atob(padded);
    if (decoded.length !== 32) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function encryptionSelfTest(value: unknown): Promise<boolean> {
  const keyBytes = decodeEncryptionKey(value);
  if (!keyBytes || keyBytes.byteLength !== 32) return false;
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode("portal-health-contract-v1");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted));
    return decrypted.length === plaintext.length && decrypted.every((valueAtIndex, index) => valueAtIndex === plaintext[index]);
  } catch {
    return false;
  }
}

function gatewayHealthUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" || parsed.username || parsed.password) return null;
    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) return null;
    if (parsed.search || parsed.hash) return null;
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/health`;
    return parsed.href;
  } catch {
    return null;
  }
}

async function gatewayReady(env: HealthEnv, fetchImpl: typeof fetch): Promise<boolean> {
  const url = gatewayHealthUrl(env.IPA_NODE_GATEWAY_URL);
  const token = typeof env.IPA_NODE_GATEWAY_TOKEN === "string" ? env.IPA_NODE_GATEWAY_TOKEN.trim() : "";
  if (!url || !token || token.length > 4096) return false;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(gatewayTimeoutMs),
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null) as { ok?: unknown } | null;
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function readinessResponse(
  env: HealthEnv,
  dependencies: HealthDependencies,
): Promise<Response> {
  if (!migrationCapableDatabase(env.DB)) {
    return readinessFailure(env, "health_database_unavailable", [
      { name: "database", state: "unready", code: "database_unavailable" },
    ]);
  }

  const databaseReady: HealthCheck = { name: "database", state: "healthy", code: "database_available" };
  let schema: PortalSchemaStatus;
  try {
    schema = await dependencies.portalSchema(env);
  } catch {
    return readinessFailure(env, "health_schema_unready", [
      databaseReady,
      { name: "schema", state: "unready", code: "schema_unavailable" },
    ]);
  }
  if (schema.state !== "ready") {
    return readinessFailure(env, "health_schema_unready", [
      databaseReady,
      {
        name: "schema",
        state: "unready",
        code: schema.state === "pending" && schema.errorCode === "schema_migration_pending"
          ? "schema_migration_pending"
          : "schema_unready",
      },
    ], schema);
  }

  const schemaReady: HealthCheck = { name: "schema", state: "healthy", code: "schema_ready" };
  if (!await encryptionSelfTest(env.CONFIG_ENCRYPTION_KEY)) {
    return readinessFailure(env, "health_encryption_unavailable", [
      databaseReady,
      schemaReady,
      { name: "encryption", state: "unready", code: "encryption_unavailable" },
    ], schema);
  }

  const encryptionReady: HealthCheck = { name: "encryption", state: "healthy", code: "encryption_ready" };
  if (!await gatewayReady(env, dependencies.fetchImpl ?? fetch)) {
    return readinessFailure(env, "health_gateway_unavailable", [
      databaseReady,
      schemaReady,
      encryptionReady,
      { name: "gateway", state: "unready", code: "gateway_unavailable" },
    ], schema);
  }

  return jsonResponse(200, healthPayload({
    check: "readiness",
    state: "healthy",
    code: "health_ready",
    metadata: metadata(env, schema),
    checks: [
      databaseReady,
      schemaReady,
      encryptionReady,
      { name: "gateway", state: "healthy", code: "gateway_ready" },
    ],
  }));
}

export async function handleHealthRequest(
  request: Request,
  env: HealthEnv,
  dependencies: HealthDependencies,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!healthPaths.has(pathname)) return null;
  if (request.method !== "GET") {
    return jsonResponse(405, { ok: false, code: "health_method_not_allowed" }, { allow: "GET" });
  }
  if (pathname === livePath) return livenessResponse(env);
  if (pathname === legacyPath) return legacyLivenessResponse();
  return await readinessResponse(env, dependencies);
}
