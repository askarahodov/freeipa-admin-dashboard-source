const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=()",
  "geolocation=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

function enabled(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

function cspHeaderName(env) {
  return String(env?.PORTAL_CSP_MODE ?? "enforce").trim().toLowerCase() === "report-only"
    ? "content-security-policy-report-only"
    : "content-security-policy";
}

export function applyHttpSecurityHeaders(request, response, env = {}) {
  const headers = new Headers(response.headers);
  headers.set(cspHeaderName(env), CSP_DIRECTIVES);
  headers.set("x-frame-options", "DENY");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", PERMISSIONS_POLICY);

  if (enabled(env?.PORTAL_HSTS_ENABLED) && new URL(request.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  } else {
    headers.delete("strict-transport-security");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const httpSecurityContract = Object.freeze({
  csp: CSP_DIRECTIVES,
  permissionsPolicy: PERMISSIONS_POLICY,
  hsts: "max-age=31536000; includeSubDomains",
});
