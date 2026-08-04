import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { RecoveryError } from "./recovery-errors.ts";

export type RecoverySqliteMode = "read-only" | "read-write";

export type RecoverySqliteDependencies = {
  sqlitePath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_SQLITE_PATH = "/usr/bin/sqlite3";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const MAX_SCRIPT_BYTES = 1_048_576;
const MAX_PATH_BYTES = 4_096;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(code: string, message: string, exitCode = 3): never {
  throw new RecoveryError(code, exitCode, message);
}

function requestInvalid(): never {
  fail("recovery_sqlite_request_invalid", "SQLite recovery request is invalid", 2);
}

function validateAbsolutePath(value: unknown): string {
  if (typeof value !== "string"
      || !value
      || !isAbsolute(value)
      || value.includes("\0")
      || value.includes("\n")
      || value.includes("\r")
      || byteLength(value) > MAX_PATH_BYTES) {
    requestInvalid();
  }
  return value;
}

async function validateExistingRegularFile(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) requestInvalid();
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    requestInvalid();
  }
}

async function validateDestination(path: string): Promise<void> {
  try {
    const existing = await lstat(path);
    if (existing) fail("recovery_sqlite_destination_exists", "SQLite backup destination already exists", 2);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") requestInvalid();
  }
  try {
    const parent = await lstat(dirname(path));
    if (parent.isSymbolicLink() || !parent.isDirectory()) requestInvalid();
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    requestInvalid();
  }
}

function validateDependencies(dependencies: RecoverySqliteDependencies): Required<Pick<RecoverySqliteDependencies, "sqlitePath" | "timeoutMs">> & Pick<RecoverySqliteDependencies, "env"> {
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) requestInvalid();
  const sqlitePath = validateAbsolutePath(dependencies.sqlitePath ?? DEFAULT_SQLITE_PATH);
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) requestInvalid();
  if (dependencies.env !== undefined && (!dependencies.env || typeof dependencies.env !== "object" || Array.isArray(dependencies.env))) requestInvalid();
  return { sqlitePath, timeoutMs, env: dependencies.env };
}

function validateScript(value: unknown): string {
  if (typeof value !== "string"
      || !value.trim()
      || value.includes("\0")
      || byteLength(value) > MAX_SCRIPT_BYTES) {
    requestInvalid();
  }
  return value;
}

function sqliteScript(script: string): string {
  return [
    ".bail on",
    ".echo off",
    ".timeout 5000",
    ".headers off",
    ".mode list",
    ".separator |",
    script,
    "",
  ].join("\n");
}

export async function runSqlite(
  input: {
    databasePath: string;
    mode: RecoverySqliteMode;
    script: string;
    maxOutputBytes?: number;
  },
  dependencies: RecoverySqliteDependencies = {},
): Promise<{ stdout: string }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) requestInvalid();
  const databasePath = validateAbsolutePath(input.databasePath);
  await validateExistingRegularFile(databasePath);
  if (input.mode !== "read-only" && input.mode !== "read-write") requestInvalid();
  const script = validateScript(input.script);
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > DEFAULT_MAX_OUTPUT_BYTES) requestInvalid();
  const resolved = validateDependencies(dependencies);

  return await new Promise<{ stdout: string }>((resolvePromise, rejectPromise) => {
    let settled = false;
    let failureCode: string | null = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const args = ["-batch"];
    if (input.mode === "read-only") args.push("-readonly");
    args.push(databasePath);
    const child = spawn(resolved.sqlitePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: resolved.env ? { ...process.env, ...resolved.env } : process.env,
      shell: false,
    });

    const terminate = (code: string) => {
      if (failureCode || settled) return;
      failureCode = code;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => terminate("recovery_sqlite_timeout"), resolved.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutputBytes) {
        terminate("recovery_sqlite_output_too_large");
        return;
      }
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxOutputBytes) terminate("recovery_sqlite_output_too_large");
    });

    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new RecoveryError("recovery_sqlite_failed", 3, "SQLite recovery operation failed"));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failureCode === "recovery_sqlite_timeout") {
        rejectPromise(new RecoveryError(failureCode, 3, "SQLite recovery operation timed out"));
        return;
      }
      if (failureCode === "recovery_sqlite_output_too_large") {
        rejectPromise(new RecoveryError(failureCode, 3, "SQLite recovery output is too large"));
        return;
      }
      if (signal !== null || code !== 0) {
        rejectPromise(new RecoveryError("recovery_sqlite_failed", 3, "SQLite recovery operation failed"));
        return;
      }
      resolvePromise({ stdout: Buffer.concat(stdoutChunks).toString("utf8") });
    });

    child.stdin.once("error", () => terminate("recovery_sqlite_failed"));
    child.stdin.end(sqliteScript(script), "utf8");
  });
}

function quoteDotCommandPath(value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) requestInvalid();
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export async function backupSqliteDatabase(
  sourcePath: string,
  destinationPath: string,
  dependencies: RecoverySqliteDependencies = {},
): Promise<{ backup: "ok" }> {
  const source = validateAbsolutePath(sourcePath);
  const destination = validateAbsolutePath(destinationPath);
  await validateExistingRegularFile(source);
  await validateDestination(destination);
  try {
    await runSqlite({
      databasePath: source,
      mode: "read-only",
      script: `.backup ${quoteDotCommandPath(destination)}`,
      maxOutputBytes: 65_536,
    }, dependencies);
    await validateExistingRegularFile(destination);
    await chmod(destination, 0o600);
    return { backup: "ok" };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    fail("recovery_sqlite_failed", "SQLite recovery operation failed");
  }
}

export async function checkpointSqlite(
  databasePath: string,
  dependencies: RecoverySqliteDependencies = {},
): Promise<{ checkpoint: "ok"; busy: number; logFrames: number; checkpointedFrames: number }> {
  const result = await runSqlite({
    databasePath,
    mode: "read-write",
    script: "PRAGMA wal_checkpoint(TRUNCATE);",
    maxOutputBytes: 65_536,
  }, dependencies);
  const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const values = lines.length === 1 ? lines[0].split("|").map(Number) : [];
  if (values.length !== 3 || values.some((value) => !Number.isSafeInteger(value) || value < 0) || values[0] !== 0) {
    fail("recovery_sqlite_checkpoint_failed", "SQLite checkpoint failed");
  }
  return {
    checkpoint: "ok",
    busy: values[0],
    logFrames: values[1],
    checkpointedFrames: values[2],
  };
}

export async function verifySqliteIntegrity(
  databasePath: string,
  dependencies: RecoverySqliteDependencies = {},
): Promise<{ integrity: "ok" }> {
  const result = await runSqlite({
    databasePath,
    mode: "read-only",
    script: "PRAGMA integrity_check;",
    maxOutputBytes: 65_536,
  }, dependencies);
  if (result.stdout.trim() !== "ok") {
    fail("recovery_sqlite_integrity_failed", "SQLite integrity verification failed");
  }
  return { integrity: "ok" };
}

export async function openSqliteHeader(path: string): Promise<Buffer> {
  const databasePath = validateAbsolutePath(path);
  await validateExistingRegularFile(databasePath);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(databasePath, constants.O_RDONLY | noFollow);
  try {
    const buffer = Buffer.alloc(16);
    const result = await handle.read(buffer, 0, buffer.byteLength, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}
