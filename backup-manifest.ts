export const PORTAL_BACKUP_FORMAT = "freeipa-admin-dashboard-backup" as const;
export const PORTAL_BACKUP_VERSION = 1 as const;

export const PORTAL_BACKUP_DOMAINS = [
  "settings",
  "local-auth",
  "rbac",
  "policies",
  "catalog",
  "operations",
  "approvals",
  "audit",
] as const;

export type PortalBackupDomain = typeof PORTAL_BACKUP_DOMAINS[number];
export type PortalBackupMode = "sanitized" | "encrypted";

export type PortalBackupEntry = {
  domain: PortalBackupDomain;
  path: string;
  bytes: number;
  sha256: string;
  records: number;
};

export type PortalBackupManifest = {
  format: typeof PORTAL_BACKUP_FORMAT;
  version: typeof PORTAL_BACKUP_VERSION;
  createdAt: string;
  schemaVersion: number;
  mode: PortalBackupMode;
  domains: PortalBackupDomain[];
  entries: PortalBackupEntry[];
  encryption: null | {
    algorithm: "AES-256-GCM";
    kdf: "PBKDF2-SHA-256";
    iterations: number;
    salt: string;
  };
};

const domainSet = new Set<string>(PORTAL_BACKUP_DOMAINS);
const forbiddenNames = new Set([
  "CONFIG_ENCRYPTION_KEY",
  "backupPassword",
  "backupKey",
  "ipaPassword",
  "xyopsApiKey",
  "encryptedSecrets",
  "sessionToken",
  "passwordHash",
]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export function canonicalBackupJson(value: unknown): string {
  return canonical(value);
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function assertSanitizedBackupPayload(value: unknown): void {
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!plainObject(current)) return;
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenNames.has(key)) throw new Error(`Sanitized backup contains forbidden field at ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "$backup");
}

export async function createBackupEntry(input: {
  domain: PortalBackupDomain;
  path: string;
  payload: unknown;
  records: number;
}): Promise<PortalBackupEntry> {
  if (!domainSet.has(input.domain)) throw new Error(`Unsupported backup domain: ${input.domain}`);
  if (!/^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(input.path) || input.path.includes("..")) throw new Error("Invalid backup entry path");
  if (!Number.isSafeInteger(input.records) || input.records < 0) throw new Error("Backup record count must be a non-negative integer");
  const content = canonicalBackupJson(input.payload);
  return {
    domain: input.domain,
    path: input.path,
    bytes: new TextEncoder().encode(content).byteLength,
    sha256: await sha256Hex(content),
    records: input.records,
  };
}

export function validateBackupManifest(value: unknown): PortalBackupManifest {
  if (!plainObject(value)) throw new Error("Backup manifest must be an object");
  if (value.format !== PORTAL_BACKUP_FORMAT) throw new Error("Unsupported backup format");
  if (value.version !== PORTAL_BACKUP_VERSION) throw new Error("Unsupported backup version");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Invalid backup creation time");
  if (!Number.isSafeInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) throw new Error("Invalid backup schema version");
  if (value.mode !== "sanitized" && value.mode !== "encrypted") throw new Error("Unsupported backup mode");
  if (!Array.isArray(value.domains) || !value.domains.length || value.domains.some((domain) => typeof domain !== "string" || !domainSet.has(domain))) throw new Error("Invalid backup domains");
  if (new Set(value.domains).size !== value.domains.length) throw new Error("Duplicate backup domains");
  if (!Array.isArray(value.entries)) throw new Error("Invalid backup entries");
  const entries = value.entries.map((entry) => {
    if (!plainObject(entry)) throw new Error("Invalid backup entry");
    if (typeof entry.domain !== "string" || !domainSet.has(entry.domain)) throw new Error("Invalid backup entry domain");
    if (!value.domains.includes(entry.domain)) throw new Error("Backup entry domain is not declared");
    if (typeof entry.path !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(entry.path) || entry.path.includes("..")) throw new Error("Invalid backup entry path");
    if (!Number.isSafeInteger(entry.bytes) || Number(entry.bytes) < 0) throw new Error("Invalid backup entry size");
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid backup checksum");
    if (!Number.isSafeInteger(entry.records) || Number(entry.records) < 0) throw new Error("Invalid backup record count");
    return entry as PortalBackupEntry;
  });
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) throw new Error("Duplicate backup entry paths");
  if (value.mode === "sanitized" && value.encryption !== null) throw new Error("Sanitized backup must not declare encryption");
  if (value.mode === "encrypted") {
    if (!plainObject(value.encryption)) throw new Error("Encrypted backup requires encryption metadata");
    if (value.encryption.algorithm !== "AES-256-GCM" || value.encryption.kdf !== "PBKDF2-SHA-256") throw new Error("Unsupported backup encryption");
    if (!Number.isSafeInteger(value.encryption.iterations) || Number(value.encryption.iterations) < 210_000) throw new Error("Backup KDF iterations are too low");
    if (typeof value.encryption.salt !== "string" || !/^[A-Za-z0-9+/]{22,}={0,2}$/.test(value.encryption.salt)) throw new Error("Invalid backup salt");
  }
  return { ...value, domains: [...value.domains] as PortalBackupDomain[], entries } as PortalBackupManifest;
}
