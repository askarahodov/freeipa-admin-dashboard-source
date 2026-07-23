import runtime from "./index";

type BaseEnv = NonNullable<Parameters<typeof runtime.fetch>[1]>;
type RuntimeContext = Parameters<typeof runtime.fetch>[2];
type IdentityMode = "anonymous" | "workspace" | "proxy" | "static";

type SecureEnv = BaseEnv & {
  PORTAL_IDENTITY_MODE?: string;
  PORTAL_IDENTITY_HEADER?: string;
  PORTAL_IDENTITY_NAME_HEADER?: string;
  PORTAL_PROXY_SECRET_HEADER?: string;
  PORTAL_PROXY_SHARED_SECRET?: string;
  PORTAL_STATIC_IDENTITY?: string;
  PORTAL_STATIC_NAME?: string;
  PORTAL_DEFAULT_ROLE?: string;
  PORTAL_RBAC_JSON?: string;
};

function identityMode(value: unknown): IdentityMode {
  return value === "workspace" || value === "proxy" || value === "static" ? value : "anonymous";
}

function safeHeaderName(value: unknown, fallback: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,126}$/.test(normalized) ? normalized : fallback;
}

function normalizedIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized.length > 160 || !normalized.includes("@") || /[\s,\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function normalizedName(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
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

function anonymousRbac(value: string | undefined): string {
  if (!value) return "{}";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "{}";
    const assignments = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([key]) => !["*", "portal-user", "anonymous"].includes(key.trim().toLowerCase())));
    return JSON.stringify(assignments);
  } catch {
    return "{}";
  }
}

async function secureContext(request: Request, sourceEnv: SecureEnv): Promise<{ request: Request; env: SecureEnv }> {
  const mode = identityMode(sourceEnv.PORTAL_IDENTITY_MODE);
  const headers = new Headers(request.headers);
  const workspaceEmail = headers.get("oai-authenticated-user-email");
  const workspaceName = headers.get("oai-authenticated-user-full-name");
  const workspaceNameEncoding = headers.get("oai-authenticated-user-full-name-encoding");

  headers.delete("oai-authenticated-user-email");
  headers.delete("oai-authenticated-user-full-name");
  headers.delete("oai-authenticated-user-full-name-encoding");

  let identity: string | null = null;
  let displayName: string | null = null;

  if (mode === "workspace") {
    identity = normalizedIdentity(workspaceEmail);
    if (workspaceNameEncoding === "percent-encoded-utf-8" && workspaceName) {
      try { displayName = normalizedName(decodeURIComponent(workspaceName)); } catch {}
    }
  } else if (mode === "proxy") {
    const identityHeader = safeHeaderName(sourceEnv.PORTAL_IDENTITY_HEADER, "x-auth-request-email");
    const nameHeader = safeHeaderName(sourceEnv.PORTAL_IDENTITY_NAME_HEADER, "x-auth-request-user");
    const secretHeader = safeHeaderName(sourceEnv.PORTAL_PROXY_SECRET_HEADER, "x-portal-proxy-secret");
    const trusted = await secretsMatch(headers.get(secretHeader), sourceEnv.PORTAL_PROXY_SHARED_SECRET);
    if (trusted) {
      identity = normalizedIdentity(headers.get(identityHeader));
      displayName = normalizedName(headers.get(nameHeader));
    }
    headers.delete(identityHeader);
    headers.delete(nameHeader);
    headers.delete(secretHeader);
  } else if (mode === "static") {
    identity = normalizedIdentity(sourceEnv.PORTAL_STATIC_IDENTITY);
    displayName = normalizedName(sourceEnv.PORTAL_STATIC_NAME);
  }

  if (identity) headers.set("oai-authenticated-user-email", identity);
  if (displayName) {
    headers.set("oai-authenticated-user-full-name", encodeURIComponent(displayName));
    headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  }

  const env: SecureEnv = {
    ...sourceEnv,
    PORTAL_DEFAULT_ROLE: String(sourceEnv.PORTAL_DEFAULT_ROLE ?? "").trim() || "viewer",
  };
  if (!identity) {
    env.PORTAL_DEFAULT_ROLE = "viewer";
    env.PORTAL_RBAC_JSON = anonymousRbac(sourceEnv.PORTAL_RBAC_JSON);
  }

  return { request: new Request(request, { headers }), env };
}

const worker = {
  async fetch(request: Request, env: SecureEnv | undefined, ctx: RuntimeContext): Promise<Response> {
    const sourceEnv = env ?? (process.env as unknown as SecureEnv);
    const secured = await secureContext(request, sourceEnv);
    return runtime.fetch(secured.request, secured.env, ctx);
  },
};

export default worker;
