function constantTimeEqual(expected, actual) {
  if (!expected || !actual) return false;
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(actual);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function normalizeAddress(value) {
  const address = String(value ?? "").trim().toLowerCase();
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function isLoopbackAddress(value) {
  const address = normalizeAddress(value);
  return address === "127.0.0.1" || address === "::1";
}

export function resolveTrustedRequestProtocol({ headers, remoteAddress, env = {} }) {
  if (String(env.PORTAL_CLIENT_IP_SOURCE ?? "none").trim().toLowerCase() !== "trusted-proxy") return "http";
  if (!isLoopbackAddress(remoteAddress)) return "http";

  const expectedSecret = String(env.PORTAL_TRUSTED_PROXY_SECRET ?? "");
  const suppliedSecret = String(headers["x-portal-proxy-secret"] ?? "");
  if (!constantTimeEqual(expectedSecret, suppliedSecret)) return "http";

  const forwarded = String(headers["x-forwarded-proto"] ?? "").trim().toLowerCase();
  if (forwarded === "https") return "https";
  if (forwarded === "http") return "http";
  return "http";
}
