import { STORAGE_STATUS_PATH } from "./storage-status-contract.ts";

export type StorageInspectCliOptions = {
  portalUrl: string;
  adminToken: string;
  timeoutMs: number;
};

export type StorageInspectCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class StorageInspectCliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StorageInspectCliError";
    this.code = code;
  }
}

type CliEnv = Record<string, string | undefined>;
type RunDependencies = { fetchImpl?: typeof fetch };

const defaultPortalUrl = "http://127.0.0.1:3001";
const defaultTimeoutMs = 5_000;
const minTimeoutMs = 500;
const maxTimeoutMs = 30_000;

function failure(code: string, exitCode: number): StorageInspectCliResult {
  return {
    exitCode,
    stdout: "",
    stderr: `${JSON.stringify({ ok: false, code })}\n`,
  };
}

function optionValue(argv: string[], index: number, name: string): { value: string; nextIndex: number } {
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
    throw new StorageInspectCliError("storage_inspect_url_invalid");
  }
}

function parsedTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < minTimeoutMs || timeout > maxTimeoutMs) {
    throw new StorageInspectCliError("storage_inspect_timeout_invalid");
  }
  return timeout;
}

function isForbiddenSecretArgument(value: string): boolean {
  return /^--(?:token|admin-token|header)(?:=|$)/i.test(value)
    || /^--[^=]*(?:secret|password|authorization|cookie|api-key)(?:=|$)/i.test(value);
}

export function parseStorageInspectCli(
  argv: readonly string[],
  env: CliEnv = process.env,
): StorageInspectCliOptions {
  let portalUrl = env.PORTAL_URL?.trim() || defaultPortalUrl;
  let timeoutMs = defaultTimeoutMs;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (isForbiddenSecretArgument(argument)) {
      throw new StorageInspectCliError("storage_inspect_token_argument_forbidden");
    }
    if (argument === "--url" || argument.startsWith("--url=")) {
      const parsed = optionValue([...argv], index, "--url");
      portalUrl = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (argument === "--timeout-ms" || argument.startsWith("--timeout-ms=")) {
      const parsed = optionValue([...argv], index, "--timeout-ms");
      timeoutMs = parsedTimeout(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    throw new StorageInspectCliError("storage_inspect_argument_unknown");
  }

  const adminToken = env.ADMIN_TOKEN?.trim() ?? "";
  if (!adminToken || adminToken.length > 4_096 || /[\u0000-\u001f\u007f]/.test(adminToken)) {
    throw new StorageInspectCliError("storage_inspect_admin_token_required");
  }

  return {
    portalUrl: normalizedPortalUrl(portalUrl),
    adminToken,
    timeoutMs,
  };
}

function validPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload.contractVersion === "1"
    && ["healthy", "degraded", "unavailable"].includes(String(payload.state ?? ""));
}

async function parsedJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) return null;
  try {
    const payload = await response.json();
    return validPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function runStorageInspectCli(
  options: StorageInspectCliOptions,
  dependencies: RunDependencies = {},
): Promise<StorageInspectCliResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(
      new URL(STORAGE_STATUS_PATH, `${options.portalUrl}/`),
      {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "application/json",
          "x-admin-token": options.adminToken,
        },
        signal: controller.signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      return failure("storage_inspect_unauthorized", 3);
    }
    if (response.status >= 300 && response.status < 400) {
      return failure("storage_inspect_protocol_error", 5);
    }
    if (response.status === 503) {
      const payload = await parsedJson(response);
      return payload
        ? { exitCode: 2, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" }
        : failure("storage_inspect_protocol_error", 5);
    }
    if (response.status < 200 || response.status >= 300) {
      return failure("storage_inspect_server_error", 2);
    }

    const payload = await parsedJson(response);
    return payload
      ? { exitCode: 0, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" }
      : failure("storage_inspect_protocol_error", 5);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "AbortError" || name === "TimeoutError"
      ? failure("storage_inspect_timeout", 4)
      : failure("storage_inspect_network_error", 4);
  } finally {
    clearTimeout(timeout);
  }
}
