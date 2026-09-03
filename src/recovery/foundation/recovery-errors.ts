export class RecoveryError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, exitCode: number, message: string) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export type SafeRecoveryFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

const codePattern = /^recovery_[a-z0-9_]{1,96}$/;
const MAX_RESULT_DEPTH = 24;
const MAX_RESULT_KEYS = 512;
const MAX_RESULT_STRING_BYTES = 65_536;

function safeCode(value: unknown): string {
  return typeof value === "string" && codePattern.test(value)
    ? value
    : "recovery_failed";
}

function safeMessage(value: unknown): string {
  if (typeof value !== "string") return "Recovery operation failed";
  const normalized = value.trim();
  if (!normalized || new TextEncoder().encode(normalized).byteLength > 512) {
    return "Recovery operation failed";
  }
  return normalized;
}

export function safeRecoveryFailure(error: unknown): SafeRecoveryFailure {
  if (error instanceof RecoveryError) {
    return {
      ok: false,
      error: {
        code: safeCode(error.code),
        message: safeMessage(error.message),
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "recovery_failed",
      message: "Recovery operation failed",
    },
  };
}

function canonicalValue(value: unknown, depth: number, keyBudget: { remaining: number }): unknown {
  if (depth > MAX_RESULT_DEPTH) {
    throw new RecoveryError("recovery_result_invalid", 1, "Recovery result is invalid");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RecoveryError("recovery_result_invalid", 1, "Recovery result is invalid");
    }
    return value;
  }
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > MAX_RESULT_STRING_BYTES) {
      throw new RecoveryError("recovery_result_invalid", 1, "Recovery result is invalid");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item, depth + 1, keyBudget));
  }
  if (!value || typeof value !== "object") {
    throw new RecoveryError("recovery_result_invalid", 1, "Recovery result is invalid");
  }
  const source = value as Record<string, unknown>;
  const entries = Object.entries(source).sort(([left], [right]) => left.localeCompare(right));
  keyBudget.remaining -= entries.length;
  if (keyBudget.remaining < 0) {
    throw new RecoveryError("recovery_result_invalid", 1, "Recovery result is invalid");
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 256) {
      throw new RecoveryError("recovery_result_invalid", 1, "Recovery result is invalid");
    }
    output[key] = canonicalValue(item, depth + 1, keyBudget);
  }
  return output;
}

export function canonicalRecoveryResult(value: unknown): unknown {
  return canonicalValue(value, 0, { remaining: MAX_RESULT_KEYS });
}
