const publishedProductionKeys = new Set([
  "d0ee92e4c9b6b9e1282d4808ff08e03de28087b1b0b3b5f44198f7bdbe782ec5",
]);

const isolatedFixtureProfiles = new Map([
  ["1d787ea814fe48eb077f436970167c890f6c0ca737557b17e00252c27595ce71", "test"],
  ["8e7f1cf2fd4232f71bb728883f8e716477fb43fb3a2fd293fe611b6d08eb7d95", "e2e"],
]);

function decodeKey(normalized) {
  if (/^[0-9a-f]{64}$/iu.test(normalized)) return Buffer.from(normalized, "hex");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) {
    throw new Error("CONFIG_ENCRYPTION_KEY must be 32-byte base64 or 64-character hex");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    throw new Error("CONFIG_ENCRYPTION_KEY must use canonical base64 encoding");
  }
  return bytes;
}

export function validateProductionEncryptionKey(value, options = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error("CONFIG_ENCRYPTION_KEY is not configured");

  const bytes = decodeKey(normalized);
  if (bytes.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes");

  if (publishedProductionKeys.has(normalized.toLowerCase())) {
    throw new Error("CONFIG_ENCRYPTION_KEY uses a previously published key and must be replaced");
  }

  const requiredFixtureProfile = isolatedFixtureProfiles.get(normalized.toLowerCase());
  const profile = String(options.profile ?? "production").trim().toLowerCase() || "production";
  if (requiredFixtureProfile && profile !== requiredFixtureProfile) {
    throw new Error("CONFIG_ENCRYPTION_KEY test fixture is only allowed in its isolated runtime profile");
  }

  if (bytes.every((byte) => byte === bytes[0])) {
    throw new Error("CONFIG_ENCRYPTION_KEY is trivially weak and must be replaced");
  }

  return normalized;
}
