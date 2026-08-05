type HealthMetricsEnv = {
  PORTAL_BUILD_VERSION?: string;
};

type HealthMetricsDependencies = {
  healthHandler: (request: Request) => Promise<Response | null>;
};

type HealthCheckPayload = {
  name?: unknown;
  state?: unknown;
};

type HealthPayload = {
  contractVersion?: unknown;
  check?: unknown;
  state?: unknown;
  ok?: unknown;
  metadata?: {
    buildVersion?: unknown;
    schemaVersion?: unknown;
    latestSchemaVersion?: unknown;
  } | null;
  checks?: unknown;
};

const metricsPath = "/metrics/health";
const maximumJsonBytes = 64 * 1024;
const readinessChecks = ["database", "schema", "encryption", "gateway"] as const;

type ReadinessCheckName = typeof readinessChecks[number];

function textHeaders(contentType = "text/plain; version=0.0.4; charset=utf-8"): HeadersInit {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ ok: false, code: "health_metrics_method_not_allowed" }), {
    status: 405,
    headers: {
      ...textHeaders("application/json; charset=utf-8"),
      allow: "GET",
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

function safeContractVersion(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  return normalized && normalized.length <= 16 && /^[0-9A-Za-z._-]+$/.test(normalized)
    ? normalized
    : "unknown";
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function metric(name: string, value: number, labels?: Record<string, string>): string {
  const labelText = labels && Object.keys(labels).length > 0
    ? `{${Object.entries(labels)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, labelValue]) => `${key}="${escapeLabelValue(labelValue)}"`)
        .join(",")}}`
    : "";
  return `${name}${labelText} ${Number.isFinite(value) ? value : 0}`;
}

function gauge(lines: string[], name: string, help: string, value: number, labels?: Record<string, string>): void {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} gauge`);
  lines.push(metric(name, value, labels));
}

function safeVersionNumber(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function healthy(payload: HealthPayload | null): boolean {
  return payload?.ok === true && payload.state === "healthy";
}

function readinessValues(payload: HealthPayload | null): Record<ReadinessCheckName, number> {
  const values: Record<ReadinessCheckName, number> = {
    database: 0,
    schema: 0,
    encryption: 0,
    gateway: 0,
  };
  if (!payload || !Array.isArray(payload.checks)) return values;
  for (const rawCheck of payload.checks) {
    if (!rawCheck || typeof rawCheck !== "object") continue;
    const check = rawCheck as HealthCheckPayload;
    if (typeof check.name !== "string" || !readinessChecks.includes(check.name as ReadinessCheckName)) continue;
    values[check.name as ReadinessCheckName] = check.state === "healthy" ? 1 : 0;
  }
  return values;
}

async function boundedPayload(response: Response | null): Promise<HealthPayload | null> {
  if (!response) return null;
  try {
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maximumJsonBytes) return null;
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumJsonBytes) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as HealthPayload : null;
  } catch {
    return null;
  }
}

function internalHealthRequest(source: Request, pathname: "/health/live" | "/health/ready"): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return new Request(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
}

async function evaluate(
  source: Request,
  pathname: "/health/live" | "/health/ready",
  handler: HealthMetricsDependencies["healthHandler"],
): Promise<HealthPayload | null> {
  try {
    return await boundedPayload(await handler(internalHealthRequest(source, pathname)));
  } catch {
    return null;
  }
}

function exposition(
  env: HealthMetricsEnv,
  live: HealthPayload | null,
  ready: HealthPayload | null,
): string {
  const lines: string[] = [];
  const configuredBuildVersion = typeof env.PORTAL_BUILD_VERSION === "string"
    ? safeBuildVersion(env.PORTAL_BUILD_VERSION)
    : safeBuildVersion(ready?.metadata?.buildVersion ?? live?.metadata?.buildVersion);
  const contractVersion = safeContractVersion(ready?.contractVersion ?? live?.contractVersion);
  const currentSchemaVersion = safeVersionNumber(ready?.metadata?.schemaVersion);
  const latestSchemaVersion = safeVersionNumber(ready?.metadata?.latestSchemaVersion);
  const schemaLag = currentSchemaVersion >= 0 && latestSchemaVersion >= 0
    ? Math.max(0, latestSchemaVersion - currentSchemaVersion)
    : -1;
  const checks = readinessValues(ready);

  gauge(lines, "portal_health_contract_info", "Version of the sanitized portal health contract.", 1, { version: contractVersion });
  gauge(lines, "portal_build_info", "Sanitized portal build metadata.", 1, { version: configuredBuildVersion });
  gauge(lines, "portal_health_live", "Whether the portal event loop can serve HTTP.", healthy(live) ? 1 : 0);
  gauge(lines, "portal_health_ready", "Whether mandatory local portal components are ready.", healthy(ready) ? 1 : 0);

  lines.push("# HELP portal_health_readiness_check Readiness of a fixed mandatory local component.");
  lines.push("# TYPE portal_health_readiness_check gauge");
  for (const check of readinessChecks) lines.push(metric("portal_health_readiness_check", checks[check], { check }));

  gauge(lines, "portal_health_schema_version", "Current canonical schema version, or -1 when unavailable.", currentSchemaVersion);
  gauge(lines, "portal_health_schema_latest_version", "Latest canonical schema version, or -1 when unavailable.", latestSchemaVersion);
  gauge(lines, "portal_health_schema_lag", "Difference between latest and current canonical schema versions, or -1 when unavailable.", schemaLag);
  gauge(
    lines,
    "portal_health_dependency_contract_info",
    "Dependency health is exposed separately as a cached sanitized JSON contract and is never refreshed by metrics scrape.",
    1,
    { mode: "cached_json", path: "/health/dependencies" },
  );

  return `${lines.join("\n")}\n`;
}

export async function handleHealthMetricsRequest(
  request: Request,
  env: HealthMetricsEnv,
  dependencies: HealthMetricsDependencies,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== metricsPath) return null;
  if (request.method !== "GET") return methodNotAllowed();

  const [live, ready] = await Promise.all([
    evaluate(request, "/health/live", dependencies.healthHandler),
    evaluate(request, "/health/ready", dependencies.healthHandler),
  ]);

  return new Response(exposition(env, live, ready), {
    status: 200,
    headers: textHeaders(),
  });
}
