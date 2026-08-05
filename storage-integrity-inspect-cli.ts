import { STORAGE_INTEGRITY_PATH } from "./storage-integrity-contract.ts";

export type StorageIntegrityInspectCliOptions = {
  portalUrl: string;
  adminToken: string;
  timeoutMs: number;
};

export type StorageIntegrityInspectCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class StorageIntegrityInspectCliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StorageIntegrityInspectCliError";
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

const quickCheckCodes = {
  healthy: "storage_quick_check_ok",
  failed: "storage_quick_check_failed",
  unsupported: "storage_quick_check_unsupported",
  unavailable: "storage_quick_check_unavailable",
} as const;

const indexCodes = new Set([
  "storage_indexes_ready",
  "storage_indexes_degraded",
  "storage_indexes_unavailable",
]);

function failure(code: string, exitCode: number): StorageIntegrityInspectCliResult {
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
    const pathIsRoot = url.pathname === "" || url.pathname === "/";
    if (
      !["http:", "https:"].includes(url.protocol)
      || Boolean(url.username)
      || Boolean(url.password)
      || !pathIsRoot
      || Boolean(url.search)
      || Boolean(url.hash)
    ) {
      throw new Error("invalid");
    }
    return url.origin;
  } catch {
    throw new StorageIntegrityInspectCliError("storage_integrity_inspect_url_invalid");
  }
}

function parsedTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < minTimeoutMs || timeout > maxTimeoutMs) {
    throw new StorageIntegrityInspectCliError("storage_integrity_inspect_timeout_invalid");
  }
  return timeout;
}

function isForbiddenSecretArgument(value: string): boolean {
  return /^--?(?:admin[-_]?token|token|header|password|cookie|authorization|auth|api[-_]?key)(?:=|$)/i.test(value)
    || /^--?[^=]*(?:secret|password|authorization|cookie|api[-_]?key)(?:=|$)/i.test(value);
}

export function parseStorageIntegrityInspectCli(
  argv: readonly string[],
  env: CliEnv = process.env,
): StorageIntegrityInspectCliOptions {
  let portalUrl = env.PORTAL_URL?.trim() || defaultPortalUrl;
  let timeoutMs = defaultTimeoutMs;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (isForbiddenSecretArgument(argument)) {
      throw new StorageIntegrityInspectCliError("storage_integrity_inspect_token_argument_forbidden");
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
    throw new StorageIntegrityInspectCliError("storage_integrity_inspect_argument_unknown");
  }

  const adminToken = env.ADMIN_TOKEN?.trim() ?? "";
  if (!adminToken || adminToken.length > 4_096 || /[\u0000-\u001f\u007f]/.test(adminToken)) {
    throw new StorageIntegrityInspectCliError("storage_integrity_inspect_admin_token_required");
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

function validQuickCheck(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, ["state", "code"])) return false;
  const state = value.state;
  return typeof state === "string"
    && Object.prototype.hasOwnProperty.call(quickCheckCodes, state)
    && value.code === quickCheckCodes[state as keyof typeof quickCheckCodes];
}

function validIndexes(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, [
    "expected",
    "present",
    "missing",
    "mismatched",
    "unexpected",
    "code",
  ])) return false;
  if (
    !safeInteger(value.expected, maxPublicCount)
    || !safeInteger(value.present, maxPublicCount)
    || !safeInteger(value.missing, maxPublicCount)
    || !safeInteger(value.mismatched, maxPublicCount)
    || !safeInteger(value.unexpected, maxPublicCount)
    || typeof value.code !== "string"
    || !indexCodes.has(value.code)
  ) return false;

  const expected = value.expected as number;
  const present = value.present as number;
  const missing = value.missing as number;
  const mismatched = value.mismatched as number;
  const unexpected = value.unexpected as number;
  if (value.code === "storage_indexes_unavailable") {
    return present === 0 && missing === 0 && mismatched === 0 && unexpected === 0;
  }
  if (present > expected || missing > expected || present + missing !== expected || mismatched > present) return false;

  if (value.code === "storage_indexes_ready") {
    return present === expected && missing === 0 && mismatched === 0 && unexpected === 0;
  }
  return missing > 0 || mismatched > 0 || unexpected > 0;
}

function validCorrelationId(value: unknown): value is string {
  return typeof value === "string" && /^cor_[A-Za-z0-9_-]{8,128}$/.test(value);
}

function validPayload(value: unknown): value is JsonObject {
  if (!isObject(value) || !exactKeys(value, [
    "contractVersion",
    "generatedAt",
    "durationMs",
    "state",
    "quickCheck",
    "indexes",
    "correlationId",
  ])) return false;
  if (
    value.contractVersion !== "1"
    || !safeInteger(value.generatedAt, Number.MAX_SAFE_INTEGER)
    || !safeInteger(value.durationMs, maxPublicDurationMs)
    || !["healthy", "degraded", "unavailable"].includes(String(value.state ?? ""))
    || !validQuickCheck(value.quickCheck)
    || !validIndexes(value.indexes)
    || !validCorrelationId(value.correlationId)
  ) return false;

  const quickState = (value.quickCheck as JsonObject).state;
  const indexCode = (value.indexes as JsonObject).code;
  const unavailable = quickState === "unavailable" || indexCode === "storage_indexes_unavailable";
  const healthy = quickState === "healthy" && indexCode === "storage_indexes_ready";
  if (value.state === "healthy") return healthy;
  if (value.state === "unavailable") return unavailable;
  return !healthy && !unavailable;
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

export async function runStorageIntegrityInspectCli(
  options: StorageIntegrityInspectCliOptions,
  dependencies: RunDependencies = {},
): Promise<StorageIntegrityInspectCliResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(
      new URL(STORAGE_INTEGRITY_PATH, `${options.portalUrl}/`),
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
      return failure("storage_integrity_inspect_unauthorized", 3);
    }
    if (response.status >= 300 && response.status < 400) {
      return failure("storage_integrity_inspect_protocol_error", 5);
    }
    if (response.status === 503) {
      const payload = await parsedJson(response);
      return payload?.state === "unavailable"
        ? { exitCode: 2, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" }
        : failure("storage_integrity_inspect_protocol_error", 5);
    }
    if (response.status < 200 || response.status >= 300) {
      return failure("storage_integrity_inspect_server_error", 2);
    }

    const payload = await parsedJson(response);
    return payload && payload.state !== "unavailable"
      ? { exitCode: 0, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" }
      : failure("storage_integrity_inspect_protocol_error", 5);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "AbortError" || name === "TimeoutError"
      ? failure("storage_integrity_inspect_timeout", 4)
      : failure("storage_integrity_inspect_network_error", 4);
  } finally {
    clearTimeout(timeout);
  }
}
