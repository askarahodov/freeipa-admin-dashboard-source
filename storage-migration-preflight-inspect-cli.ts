import { STORAGE_MIGRATION_PREFLIGHT_PATH } from "./storage-migration-preflight-contract.ts";

export type StorageMigrationPreflightInspectOptions = {
  portalUrl: string;
  adminToken: string;
  timeoutMs: number;
};

export type StorageMigrationPreflightInspectResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class StorageMigrationPreflightInspectCliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StorageMigrationPreflightInspectCliError";
    this.code = code;
  }
}

type CliEnv = Record<string, string | undefined>;
type RunDependencies = { fetchImpl?: typeof fetch };
type JsonObject = Record<string, unknown>;

const defaultPortalUrl = "http://127.0.0.1:3001";
const defaultTimeoutMs = 5_000;
const minTimeoutMs = 500;
const maxTimeoutMs = 30_000;
const maxPublicDurationMs = 60_000;
const maxPublicCount = 10_000;
const backupMaxAgeMs = 86_400_000;
const lockTtlMs = 60_000;

const schemaCodes = {
  ready: "migration_schema_ready",
  drift: "migration_schema_drift",
  incompatible: "migration_registry_snapshot_required",
  unavailable: "migration_schema_unavailable",
} as const;

const journalCodes = {
  valid: "migration_journal_valid",
  missing: "migration_journal_missing",
  invalid: "migration_journal_invalid",
  future: "migration_journal_future",
  unavailable: "migration_journal_unavailable",
} as const;

const integrityCodes = {
  healthy: "migration_quick_check_ok",
  failed: "migration_quick_check_failed",
  unsupported: "migration_quick_check_unsupported",
  not_required: "migration_quick_check_not_required",
  unavailable: "migration_quick_check_unavailable",
} as const;

const backupCodes = {
  ready: "migration_backup_ready",
  missing: "migration_backup_missing",
  stale: "migration_backup_stale",
  invalid: "migration_backup_invalid",
  not_required: "migration_backup_not_required",
  unavailable: "migration_backup_unavailable",
} as const;

const lockCodes = {
  available: "migration_lock_available",
  held: "migration_lock_held",
  stale: "migration_lock_stale",
  not_required: "migration_lock_not_required",
  unavailable: "migration_lock_unavailable",
} as const;

function failure(code: string, exitCode: number): StorageMigrationPreflightInspectResult {
  return {
    exitCode,
    stdout: "",
    stderr: `${JSON.stringify({ ok: false, code })}\n`,
  };
}

function optionValue(argv: readonly string[], index: number, name: string): { value: string; nextIndex: number } {
  const current = argv[index];
  if (current.startsWith(`${name}=`)) return { value: current.slice(name.length + 1), nextIndex: index };
  if (current === name) return { value: argv[index + 1] ?? "", nextIndex: index + 1 };
  return { value: "", nextIndex: index };
}

function normalizedPortalUrl(value: string): string {
  try {
    const url = new URL(value);
    const rootPath = url.pathname === "" || url.pathname === "/";
    if (
      !["http:", "https:"].includes(url.protocol)
      || Boolean(url.username)
      || Boolean(url.password)
      || !rootPath
      || Boolean(url.search)
      || Boolean(url.hash)
    ) throw new Error("invalid");
    return url.origin;
  } catch {
    throw new StorageMigrationPreflightInspectCliError("storage_migration_preflight_inspect_url_invalid");
  }
}

function parsedTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < minTimeoutMs || timeout > maxTimeoutMs) {
    throw new StorageMigrationPreflightInspectCliError("storage_migration_preflight_inspect_timeout_invalid");
  }
  return timeout;
}

function isForbiddenSecretArgument(value: string): boolean {
  return /^--?(?:admin[-_]?token|token|header|password|cookie|authorization|auth|api[-_]?key)(?:=|$)/i.test(value)
    || /^--?[^=]*(?:secret|password|authorization|cookie|api[-_]?key)(?:=|$)/i.test(value);
}

export function parseStorageMigrationPreflightInspectCli(
  argv: readonly string[],
  env: CliEnv = process.env,
): StorageMigrationPreflightInspectOptions {
  let portalUrl = env.PORTAL_URL?.trim() || defaultPortalUrl;
  let timeoutMs = defaultTimeoutMs;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (isForbiddenSecretArgument(argument)) {
      throw new StorageMigrationPreflightInspectCliError("storage_migration_preflight_inspect_token_argument_forbidden");
    }
    if (argument === "--url" || argument.startsWith("--url=")) {
      const parsed = optionValue(argv, index, "--url");
      portalUrl = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (argument === "--timeout-ms" || argument.startsWith("--timeout-ms=")) {
      const parsed = optionValue(argv, index, "--timeout-ms");
      timeoutMs = parsedTimeout(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    throw new StorageMigrationPreflightInspectCliError("storage_migration_preflight_inspect_argument_unknown");
  }

  const adminToken = env.ADMIN_TOKEN?.trim() ?? "";
  if (!adminToken || adminToken.length > 4_096 || /[\u0000-\u001f\u007f]/.test(adminToken)) {
    throw new StorageMigrationPreflightInspectCliError("storage_migration_preflight_inspect_admin_token_required");
  }

  return {
    portalUrl: normalizedPortalUrl(portalUrl),
    adminToken,
    timeoutMs,
  };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function nullableInteger(value: unknown, maximum: number): value is number | null {
  return value === null || safeInteger(value, maximum);
}

function stateCodeMatches<T extends Record<string, string>>(
  value: JsonObject,
  codes: T,
): boolean {
  return typeof value.state === "string"
    && Object.prototype.hasOwnProperty.call(codes, value.state)
    && value.code === codes[value.state as keyof T];
}

function validSchema(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "currentVersion", "latestVersion", "code"])) return false;
  if (!stateCodeMatches(value, schemaCodes)) return false;
  if (!nullableInteger(value.currentVersion, maxPublicCount) || !nullableInteger(value.latestVersion, maxPublicCount)) return false;
  if (value.state === "unavailable") return value.currentVersion === null;
  if (typeof value.currentVersion !== "number" || typeof value.latestVersion !== "number") return false;
  return value.currentVersion <= value.latestVersion;
}

function validJournal(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "appliedCount", "pendingCount", "code"])) return false;
  return stateCodeMatches(value, journalCodes)
    && safeInteger(value.appliedCount, maxPublicCount)
    && safeInteger(value.pendingCount, maxPublicCount);
}

function validIntegrity(value: unknown): value is JsonObject {
  return isObject(value)
    && exactKeys(value, ["state", "code"])
    && stateCodeMatches(value, integrityCodes);
}

function validBackup(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "ageMs", "maxAgeMs", "code"])) return false;
  if (!stateCodeMatches(value, backupCodes) || value.maxAgeMs !== backupMaxAgeMs) return false;
  if (!nullableInteger(value.ageMs, Number.MAX_SAFE_INTEGER)) return false;
  if (value.state === "ready" || value.state === "stale") return typeof value.ageMs === "number";
  return value.ageMs === null;
}

function validLock(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "blocking", "ageMs", "ttlMs", "code"])) return false;
  if (!stateCodeMatches(value, lockCodes) || value.ttlMs !== lockTtlMs || typeof value.blocking !== "boolean") return false;
  if (!nullableInteger(value.ageMs, Number.MAX_SAFE_INTEGER)) return false;

  switch (value.state) {
    case "available":
    case "not_required":
      return value.blocking === false && value.ageMs === null;
    case "held":
      return value.blocking === true && typeof value.ageMs === "number" && value.ageMs <= lockTtlMs;
    case "stale":
      return value.blocking === false && typeof value.ageMs === "number" && value.ageMs > lockTtlMs;
    case "unavailable":
      return value.blocking === true && value.ageMs === null;
    default:
      return false;
  }
}

function validCorrelationId(value: unknown): value is string {
  return typeof value === "string" && /^cor_[A-Za-z0-9_-]{8,128}$/.test(value);
}

function firstBlockingCode(value: JsonObject): string | null {
  const schema = value.schema as JsonObject;
  const integrity = value.integrity as JsonObject;
  const backup = value.backup as JsonObject;
  const lock = value.lock as JsonObject;
  if (schema.state !== "ready") return String(schema.code);
  if (integrity.state !== "healthy") return String(integrity.code);
  if (backup.state !== "ready") return String(backup.code);
  if (lock.blocking === true) return String(lock.code);
  return null;
}

function validOverallState(value: JsonObject): boolean {
  const state = value.state;
  const decision = value.decision;
  const code = value.code;
  const pending = value.pendingMigrationCount;
  const schema = value.schema as JsonObject;
  const journal = value.journal as JsonObject;
  const integrity = value.integrity as JsonObject;
  const backup = value.backup as JsonObject;
  const lock = value.lock as JsonObject;

  if (journal.pendingCount !== pending) return false;

  if (state === "ready") {
    return decision === "allow"
      && code === "migration_preflight_ready"
      && Number(pending) > 0
      && schema.state === "ready"
      && journal.state === "valid"
      && integrity.state === "healthy"
      && backup.state === "ready"
      && (lock.state === "available" || lock.state === "stale")
      && lock.blocking === false;
  }

  if (state === "not_required") {
    return decision === "deny"
      && code === "migration_preflight_not_required"
      && pending === 0
      && schema.state === "ready"
      && journal.state === "valid"
      && integrity.state === "not_required"
      && backup.state === "not_required"
      && lock.state === "not_required"
      && lock.blocking === false;
  }

  if (state === "blocked") {
    const blockingCode = firstBlockingCode(value);
    return decision === "deny"
      && Number(pending) > 0
      && journal.state === "valid"
      && blockingCode !== null
      && code === blockingCode;
  }

  if (state === "unavailable") {
    return decision === "deny"
      && code === "migration_preflight_unavailable"
      && pending === 0
      && schema.state === "unavailable"
      && journal.state === "unavailable"
      && integrity.state === "unavailable"
      && backup.state === "unavailable"
      && lock.state === "unavailable"
      && lock.blocking === true;
  }

  return false;
}

function validPayload(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, [
    "contractVersion",
    "generatedAt",
    "durationMs",
    "state",
    "decision",
    "code",
    "pendingMigrationCount",
    "schema",
    "journal",
    "integrity",
    "backup",
    "lock",
    "correlationId",
  ])) return false;

  return value.contractVersion === "1"
    && safeInteger(value.generatedAt, Number.MAX_SAFE_INTEGER)
    && safeInteger(value.durationMs, maxPublicDurationMs)
    && safeInteger(value.pendingMigrationCount, maxPublicCount)
    && ["ready", "not_required", "blocked", "unavailable"].includes(String(value.state ?? ""))
    && ["allow", "deny"].includes(String(value.decision ?? ""))
    && typeof value.code === "string"
    && /^migration_[a-z0-9_]{3,80}$/.test(value.code)
    && validSchema(value.schema)
    && validJournal(value.journal)
    && validIntegrity(value.integrity)
    && validBackup(value.backup)
    && validLock(value.lock)
    && validCorrelationId(value.correlationId)
    && validOverallState(value);
}

async function parsedJson(response: Response): Promise<JsonObject | null> {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) return null;
  try {
    const payload = await response.json();
    return validPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function runStorageMigrationPreflightInspectCli(
  options: StorageMigrationPreflightInspectOptions,
  dependencies: RunDependencies = {},
): Promise<StorageMigrationPreflightInspectResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(
      new URL(STORAGE_MIGRATION_PREFLIGHT_PATH, `${options.portalUrl}/`),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-admin-token": options.adminToken,
        },
        body: "{}",
        signal: controller.signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      return failure("storage_migration_preflight_inspect_unauthorized", 3);
    }
    if (response.status >= 300 && response.status < 400) {
      return failure("storage_migration_preflight_inspect_protocol_error", 5);
    }
    if (response.status >= 500 && response.status !== 503) {
      return failure("storage_migration_preflight_inspect_server_error", 2);
    }
    if (response.status !== 200 && response.status !== 503) {
      return failure("storage_migration_preflight_inspect_protocol_error", 5);
    }

    const payload = await parsedJson(response);
    if (!payload) return failure("storage_migration_preflight_inspect_protocol_error", 5);
    if (response.status === 503) {
      return payload.state === "unavailable"
        ? { exitCode: 2, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" }
        : failure("storage_migration_preflight_inspect_protocol_error", 5);
    }
    if (payload.state === "unavailable") return failure("storage_migration_preflight_inspect_protocol_error", 5);
    return {
      exitCode: payload.state === "ready" || payload.state === "not_required" ? 0 : 2,
      stdout: `${JSON.stringify(payload, null, 2)}\n`,
      stderr: "",
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "AbortError" || name === "TimeoutError"
      ? failure("storage_migration_preflight_inspect_timeout", 4)
      : failure("storage_migration_preflight_inspect_network_error", 4);
  } finally {
    clearTimeout(timeout);
  }
}
