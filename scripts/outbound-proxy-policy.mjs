const minimumSupportedProxyVersions = [
  { major: 22, minor: 21 },
  { major: 24, minor: 5 },
];

function proxyEnabled(value) {
  return String(value ?? "").trim() === "1";
}

function parsedNodeVersion(value) {
  const match = String(value ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function nodeSupportsBuiltInProxy(value) {
  const version = parsedNodeVersion(value);
  if (!version) return false;
  if (version.major === 22) return version.minor >= 21;
  if (version.major === 24) return version.minor >= 5;
  return version.major >= 25;
}

function effectiveValue(env, upper, lower) {
  const lowerValue = env?.[lower];
  if (lowerValue) return String(lowerValue).trim();
  return String(env?.[upper] ?? "").trim();
}

function validateProxyUrl(value, name) {
  if (!value) return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) proxy URL`);
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || !parsed.hostname || parsed.hash) {
    throw new Error(`${name} must be an absolute HTTP(S) proxy URL`);
  }
}

function noProxyBypassesGateway(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => entry === "*" || entry === "127.0.0.1");
}

export function outboundProxyPolicy(env = process.env, nodeVersion = process.versions.node) {
  const enabled = proxyEnabled(env?.NODE_USE_ENV_PROXY);
  if (!enabled) return { enabled: false };

  if (!nodeSupportsBuiltInProxy(nodeVersion)) {
    throw new Error(
      "NODE_USE_ENV_PROXY=1 requires Node.js 22.21.0+ on the Node 22 line, Node.js 24.5.0+, or a newer supported major",
    );
  }

  const httpProxy = effectiveValue(env, "HTTP_PROXY", "http_proxy");
  const httpsProxy = effectiveValue(env, "HTTPS_PROXY", "https_proxy");
  if (!httpProxy && !httpsProxy) {
    throw new Error("NODE_USE_ENV_PROXY=1 requires HTTP_PROXY/HTTPS_PROXY (or lowercase equivalents)");
  }
  validateProxyUrl(httpProxy, "HTTP_PROXY/http_proxy");
  validateProxyUrl(httpsProxy, "HTTPS_PROXY/https_proxy");

  const noProxy = effectiveValue(env, "NO_PROXY", "no_proxy");
  if (!noProxyBypassesGateway(noProxy)) {
    throw new Error("Outbound proxy configuration must bypass 127.0.0.1 in NO_PROXY/no_proxy for the private FreeIPA Gateway");
  }

  return {
    enabled: true,
    httpProxyConfigured: Boolean(httpProxy),
    httpsProxyConfigured: Boolean(httpsProxy),
    gatewayBypassed: true,
  };
}

export async function configureOutboundProxy({
  env = process.env,
  nodeVersion = process.versions.node,
  setGlobalProxyFromEnv,
} = {}) {
  const policy = outboundProxyPolicy(env, nodeVersion);
  if (!policy.enabled) return policy;

  let apply = setGlobalProxyFromEnv;
  if (!apply) {
    const http = await import("node:http");
    apply = http.setGlobalProxyFromEnv;
  }
  if (typeof apply !== "function") {
    throw new Error("This Node.js runtime does not expose built-in global proxy configuration");
  }

  apply(env);
  return policy;
}

export const OUTBOUND_PROXY_MINIMUMS = Object.freeze(minimumSupportedProxyVersions.map((item) => Object.freeze({ ...item })));
