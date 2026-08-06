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

const journalInvalidCodes = new Set([
  "migration_journal_malformed",
  "migration_journal_duplicate",
  "migration_journal_future_version",
  "migration_journal_gap",
  "migration_journal_checksum_mismatch",
]);
const schemaIncompatibleCodes = new Set([
  "migration_registry_snapshot_required",
  "migration_schema_incompatible",
  "migration_schema_partial_apply",
]);

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

function validSchema(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "currentVersion", "latestVersion", "code"])) return false;
  if (!nullableInteger(value.currentVersion, maxPublicCount) || !nullableInteger(value.latestVersion, maxPublicCount)) return false;
  if (
    typeof value.currentVersion === "number"
    && typeof value.latestVersion === "number"
    && value.currentVersion > value.latestVersion
  ) return false;

  if (value.state === "ready") {
    return value.code === "migration_schema_ready"
      && typeof value.currentVersion === "number"
      && typeof value.latestVersion === "number";
  }
  if (value.state === "incompatible") {
    return typeof value.currentVersion === "number"
      && typeof value.latestVersion === "number"
      && typeof value.code === "string"
      && schemaIncompatibleCodes.has(value.code);
  }
  return value.state === "unavailable" && value.code === "migration_schema_unavailable";
}

function validJournal(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "appliedCount", "pendingCount", "code"])) return false;
  if (!safeInteger(value.appliedCount, maxPublicCount) || !safeInteger(value.pendingCount, maxPublicCount)) return false;
  if (value.state === "valid") return value.code === "migration_journal_valid";
  if (value.state === "invalid") return typeof value.code === "string" && journalInvalidCodes.has(value.code);
  return value.state === "unavailable" && value.code === "migration_journal_unavailable";
}

function validIntegrity(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "code"])) return false;
  switch (value.state) {
    case "healthy": return value.code === "migration_quick_check_ok";
    case "failed": return value.code === "migration_quick_check_failed";
    case "unsupported": return value.code === "migration_quick_check_unsupported";
    case "not_required": return value.code === "migration_quick_check_not_required";
    case "unavailable": return value.code === "migration_quick_check_unavailable";
    default: return false;
  }
}

function validBackup(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "ageMs", "maxAgeMs", "code"])) return false;
  if (value.maxAgeMs !== backupMaxAgeMs || !nullableInteger(value.ageMs, Number.MAX_SAFE_INTEGER)) return false;
  switch (value.state) {
    case "ready":
      return value.code === "migration_backup_ready" && typeof value.ageMs === "number" && value.ageMs <= backupMaxAgeMs;
    case "stale":
      return value.code === "migration_backup_stale" && typeof value.ageMs === "number" && value.ageMs > backupMaxAgeMs;
    case "missing":
      return value.code === "migration_backup_missing" && value.ageMs === null;
    case "incompatible":
      return value.code === "migration_backup_incompatible" && value.ageMs === null;
    case "not_required":
      return value.code === "migration_backup_not_required" && value.ageMs === null;
    case "unavailable":
      return value.code === "migration_backup_unavailable" && value.ageMs === null;
    default:
      return false;
  }
}

function validLock(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "blocking", "ageMs", "ttlMs", "code"])) return false;
  if (value.ttlMs !== lockTtlMs || typeof value.blocking !== "boolean") return false;
  if (!nullableInteger(value.ageMs, Number.MAX_SAFE_INTEGER)) return false;

  switch (value.state) {
    case "available":
      return value.code === "migration_lock_available" && value.blocking === false && value.ageMs === null;
    case "held":
      return value.code === "migration_lock_held"
        && value.blocking === true
        && typeof value.ageMs === "number"
        && value.ageMs <= lockTtlMs;
    case "stale":
      return value.code === "migration_lock_stale"
        && value.blocking === false
        && typeof value.ageMs === "number"
        && value.ageMs > lockTtlMs;
    case "not_required":
      return value.code === "migration_lock_not_required" && value.blocking === false && value.ageMs === null;
    case "unavailable":
      return value.code === "migration_lock_unavailable" && value.blocking === true && value.ageMs === null;
    default:
      return false;
  }
}

function validCorrelationId(value: unknown): value is string {
  return typeof value === "string" && /^cor_[A-Za-z0-9_-]{8,128}$/.test(value);
}

function isUnavailableIntegrity(value: JsonObject): boolean {
  return value.state === "unavailable" && value.code === "migration_quick_check_unavailable";
}

function isUnavailableBackup(value: JsonObject): boolean {
  return value.state === "unavailable"
    && value.ageMs === null
    && value.code === "migration_backup_unavailable";
}

function isUnavailableLock(value: JsonObject): boolean {
  return value.state === "unavailable"
    && value.blocking === true
    && value.ageMs === null
    && value.code === "migration_lock_unavailable";
}

function hasUnevaluatedRemainder(value: JsonObject): boolean {
  return isUnavailableIntegrity(value.integrity as JsonObject)
    && isUnavailableBackup(value.backup as JsonObject)
    && isUnavailableLock(value.lock as JsonObject);
}

function firstDownstreamBlockingCode(value: JsonObject): string | null {
  const integrity = value.integrity as JsonObject;
  const backup = value.backup as JsonObject;
  const lock = value.lock as JsonObject;
  if (integrity.state !== "healthy") return String(integrity.code);
  if (backup.state !== "ready") return String(backup.code);
  if (lock.blocking === true) return String(lock.code);
  return null;
}

function anyDownstreamUnavailable(value: JsonObject): boolean {
  return (value.integrity as JsonObject).state === "unavailable"
    || (value.backup as JsonObject).state === "unavailable"
    || (value.lock as JsonObject).state === "unavailable";
}

function validBaseUnavailable(value: JsonObject): boolean {
  const schema = value.schema as JsonObject;
  const journal = value.journal as JsonObject;
  return value.state === "unavailable"
    && value.decision === "deny"
    && value.pendingMigrationCount === 0
    && [
      "migration_preflight_unavailable",
      "migration_preflight_database_unavailable",
      "migration_journal_unavailable",
    ].includes(String(value.code))
    && schema.state === "unavailable"
    && schema.currentVersion === null
    && journal.state === "unavailable"
    && journal.appliedCount === 0
    && journal.pendingCount === 0
    && hasUnevaluatedRemainder(value);
}

function validJournalBlock(value: JsonObject): boolean {
  const schema = value.schema as JsonObject;
  const journal = value.journal as JsonObject;
  return value.state === "blocked"
    && value.decision === "deny"
    && value.pendingMigrationCount === 0
    && journal.state === "invalid"
    && value.code === journal.code
    && schema.state === "unavailable"
    && schema.currentVersion === null
    && hasUnevaluatedRemainder(value);
}

function validSchemaStage(value: JsonObject): boolean {
  const schema = value.schema as JsonObject;
  const journal = value.journal as JsonObject;
  const pending = Number(value.pendingMigrationCount);
  if (journal.state !== "valid" || journal.pendingCount !== pending || !hasUnevaluatedRemainder(value)) return false;
  if (schema.state === "incompatible") {
    if (schema.code === "migration_registry_snapshot_required" || schema.code === "migration_schema_partial_apply") {
      if (pending < 1) return false;
    }
    return value.state === "blocked" && value.decision === "deny" && value.code === schema.code;
  }
  if (schema.state === "unavailable") {
    return value.state === "unavailable" && value.decision === "deny" && value.code === schema.code;
  }
  return false;
}

function validNoPending(value: JsonObject): boolean {
  const schema = value.schema as JsonObject;
  const journal = value.journal as JsonObject;
  const integrity = value.integrity as JsonObject;
  const backup = value.backup as JsonObject;
  const lock = value.lock as JsonObject;
  return value.state === "not_required"
    && value.decision === "deny"
    && value.code === "migration_preflight_not_required"
    && value.pendingMigrationCount === 0
    && schema.state === "ready"
    && journal.state === "valid"
    && journal.pendingCount === 0
    && integrity.state === "not_required"
    && backup.state === "not_required"
    && lock.state === "not_required"
    && lock.blocking === false;
}

function validDownstreamStage(value: JsonObject): boolean {
  const schema = value.schema as JsonObject;
  const journal = value.journal as JsonObject;
  const pending = Number(value.pendingMigrationCount);
  if (
    pending < 1
    || schema.state !== "ready"
    || journal.state !== "valid"
    || journal.pendingCount !== pending
  ) return false;

  const blockingCode = firstDownstreamBlockingCode(value);
  if (blockingCode === null) {
    return value.state === "ready"
      && value.decision === "allow"
      && value.code === "migration_preflight_ready";
  }
  return value.state === (anyDownstreamUnavailable(value) ? "unavailable" : "blocked")
    && value.decision === "deny"
    && value.code === blockingCode;
}

function validOverallState(value: JsonObject): boolean {
  return validBaseUnavailable(value)
    || validJournalBlock(value)
    || validSchemaStage(value)
    || validNoPending(value)
    || validDownstreamStage(value);
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
