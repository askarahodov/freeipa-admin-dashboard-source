import { constants } from "node:fs";
import type { FileHandle, Stats } from "node:fs/promises";
import { open } from "node:fs/promises";

import { RecoveryError } from "./recovery-errors.ts";
import { resolveContainedRegularFile } from "./recovery-paths.ts";

const MAX_SECRET_FILE_BYTES = 1_048_576;

function secretFailure(code = "recovery_secret_invalid"): never {
  throw new RecoveryError(
    code,
    2,
    code === "recovery_secret_permissions_invalid"
      ? "Recovery secret file permissions are invalid"
      : "Recovery secret file is invalid",
  );
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function validateOptions(maxBytes: number, trimFinalNewline: boolean): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SECRET_FILE_BYTES) {
    secretFailure();
  }
  if (typeof trimFinalNewline !== "boolean") secretFailure();
}

async function closeQuietly(handle: FileHandle | null): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // The read result is already invalid when the descriptor cannot be closed cleanly.
  }
}

export async function readSecretFile(input: {
  root: string;
  path: string;
  maxBytes: number;
  trimFinalNewline: boolean;
}): Promise<string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) secretFailure();
  validateOptions(input.maxBytes, input.trimFinalNewline);

  let handle: FileHandle | null = null;
  let bytes: Buffer | null = null;
  try {
    const filePath = await resolveContainedRegularFile(input.root, input.path, "secret");
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    handle = await open(filePath, constants.O_RDONLY | noFollow);
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > input.maxBytes) secretFailure();
    if ((before.mode & 0o777) !== 0o600) secretFailure("recovery_secret_permissions_invalid");

    bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(before, after) || bytes.byteLength !== before.size) secretFailure();

    let value: string;
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      secretFailure();
    }
    if (!value || value.includes("\0")) secretFailure();
    if (input.trimFinalNewline && value.endsWith("\n")) {
      value = value.slice(0, -1);
      if (!value || value.endsWith("\n")) secretFailure();
    }
    if (!value) secretFailure();
    return value;
  } catch (error) {
    if (error instanceof RecoveryError) {
      if (error.code === "recovery_secret_permissions_invalid"
          || error.code === "recovery_secret_invalid") {
        throw error;
      }
      secretFailure();
    }
    secretFailure();
  } finally {
    if (bytes) bytes.fill(0);
    await closeQuietly(handle);
  }
}
