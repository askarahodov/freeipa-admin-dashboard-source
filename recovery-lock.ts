import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

import { RecoveryError } from "./recovery-errors.ts";

export type RecoveryLockMode = "runtime" | "recovery";
export type RecoveryLockStdio = "inherit" | "pipe";

const FLOCK_PATH = "/usr/bin/flock";
const TRUE_PATH = "/usr/bin/true";
const CONFLICT_EXIT_CODE = 75;
const MAX_PATH_BYTES = 4_096;
const MAX_ARGUMENT_BYTES = 65_536;
const MAX_CAPTURE_BYTES = 65_536;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalid(): never {
  throw new RecoveryError(
    "recovery_lock_invalid",
    2,
    "Recovery lock request is invalid",
  );
}

function validateAbsolutePath(value: unknown, maxBytes: number): string {
  if (typeof value !== "string"
      || !value
      || !isAbsolute(value)
      || value.includes("\0")
      || byteLength(value) > maxBytes) {
    invalid();
  }
  return value;
}

function validateArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 4_096) invalid();
  const result: string[] = [];
  for (const argument of value) {
    if (typeof argument !== "string"
        || argument.includes("\0")
        || byteLength(argument) > MAX_ARGUMENT_BYTES) {
      invalid();
    }
    result.push(argument);
  }
  return result;
}

function normalizedSpawnFailure(): RecoveryError {
  return new RecoveryError(
    "recovery_lock_failed",
    1,
    "Recovery lock operation failed",
  );
}

function collectBounded(
  stream: NodeJS.ReadableStream | null,
  onOverflow: () => void,
): void {
  if (!stream) return;
  let bytes = 0;
  stream.on("data", (chunk: Buffer | string) => {
    bytes += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
    if (bytes > MAX_CAPTURE_BYTES) onOverflow();
  });
  stream.resume();
}

export async function runWithRecoveryLock(input: {
  lockPath: string;
  mode: RecoveryLockMode;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  stdio?: RecoveryLockStdio;
}): Promise<number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const lockPath = validateAbsolutePath(input.lockPath, MAX_PATH_BYTES);
  if (input.mode !== "runtime" && input.mode !== "recovery") invalid();
  const command = validateAbsolutePath(input.command, MAX_PATH_BYTES);
  const args = validateArguments(input.args);
  const stdio = input.stdio ?? "inherit";
  if (stdio !== "inherit" && stdio !== "pipe") invalid();
  if (input.env !== undefined && (!input.env || typeof input.env !== "object" || Array.isArray(input.env))) invalid();

  return await new Promise<number>((resolvePromise, rejectPromise) => {
    let settled = false;
    let overflowed = false;
    const child = spawn("/usr/bin/flock", [
      "--exclusive",
      "--nonblock",
      "--conflict-exit-code", String(CONFLICT_EXIT_CODE),
      "--no-fork",
      lockPath,
      "--",
      command,
      ...args,
    ], {
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      env: input.env ? { ...input.env } : process.env,
      shell: false,
    });

    const failOverflow = () => {
      if (overflowed || settled) return;
      overflowed = true;
      child.kill("SIGKILL");
    };
    if (stdio === "pipe") {
      collectBounded(child.stdout, failOverflow);
      collectBounded(child.stderr, failOverflow);
    }

    child.once("error", () => {
      if (settled) return;
      settled = true;
      rejectPromise(normalizedSpawnFailure());
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (overflowed || signal !== null || code === null) {
        rejectPromise(normalizedSpawnFailure());
        return;
      }
      if (code === CONFLICT_EXIT_CODE) {
        rejectPromise(new RecoveryError(
          "recovery_lock_busy",
          CONFLICT_EXIT_CODE,
          "Recovery lock is busy",
        ));
        return;
      }
      resolvePromise(code);
    });
  });
}

export async function probeRecoveryLock(lockPath: string): Promise<{ available: boolean }> {
  try {
    const exitCode = await runWithRecoveryLock({
      lockPath,
      mode: "recovery",
      command: TRUE_PATH,
      args: [],
      stdio: "pipe",
    });
    if (exitCode !== 0) throw normalizedSpawnFailure();
    return { available: true };
  } catch (error) {
    if (error instanceof RecoveryError && error.code === "recovery_lock_busy") {
      return { available: false };
    }
    throw error;
  }
}

void FLOCK_PATH;
