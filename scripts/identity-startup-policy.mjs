const LOCAL_BOOTSTRAP_PASSWORD_PLACEHOLDER = "replace-with-a-strong-password-at-least-12-characters";
const STATIC_ALLOWED_PROFILES = new Set(["development", "test", "e2e"]);

function normalized(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateIdentityStartup(env = {}) {
  const mode = normalized(env.PORTAL_IDENTITY_MODE).toLowerCase() || "anonymous";
  const profile = normalized(env.PORTAL_RUNTIME_PROFILE).toLowerCase() || "production";
  const warnings = [];

  if (mode === "local") {
    const username = normalized(env.PORTAL_BOOTSTRAP_ADMIN_USERNAME);
    const password = typeof env.PORTAL_BOOTSTRAP_ADMIN_PASSWORD === "string" ? env.PORTAL_BOOTSTRAP_ADMIN_PASSWORD : "";
    if (!username || password.length < 12 || password === LOCAL_BOOTSTRAP_PASSWORD_PLACEHOLDER) {
      throw new Error("Local authentication bootstrap administrator credentials are required and must use a non-placeholder password of at least 12 characters");
    }
  }

  if (mode === "static") {
    if (!STATIC_ALLOWED_PROFILES.has(profile)) {
      throw new Error("Static portal identity is development-only and requires an explicit development/test/e2e runtime profile");
    }
    warnings.push("Static portal identity is enabled for an isolated non-production runtime profile");
  }

  return { mode, profile, warnings };
}
