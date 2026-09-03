import { lstatSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { RecoveryError } from "./recovery-errors.ts";

export type RecoveryRoots = {
  dataRoot: string;
  artifactRoot: string;
  secretsRoot: string;
};

const MAX_PATH_BYTES = 4_096;

function pathBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function pathFailure(code = "recovery_path_invalid"): never {
  throw new RecoveryError(code, 2, code === "recovery_roots_invalid"
    ? "Recovery roots are invalid"
    : "Recovery path is invalid");
}

function validPathText(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\0")
    && pathBytes(value) <= MAX_PATH_BYTES;
}

function canonicalDirectory(value: unknown): string {
  if (!validPathText(value) || !isAbsolute(value)) pathFailure("recovery_roots_invalid");
  try {
    const metadata = lstatSync(value);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) pathFailure("recovery_roots_invalid");
    const canonical = realpathSync.native(value);
    if (!isAbsolute(canonical) || pathBytes(canonical) > MAX_PATH_BYTES) pathFailure("recovery_roots_invalid");
    return canonical;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    pathFailure("recovery_roots_invalid");
  }
}

function contains(parent: string, child: string): boolean {
  const offset = relative(parent, child);
  return offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset));
}

function rootsOverlap(left: string, right: string): boolean {
  return contains(left, right) || contains(right, left);
}

export function resolveRecoveryRoots(input: RecoveryRoots): RecoveryRoots {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    pathFailure("recovery_roots_invalid");
  }
  const dataRoot = canonicalDirectory(input.dataRoot);
  const artifactRoot = canonicalDirectory(input.artifactRoot);
  const secretsRoot = canonicalDirectory(input.secretsRoot);
  if (rootsOverlap(dataRoot, artifactRoot)
      || rootsOverlap(dataRoot, secretsRoot)
      || rootsOverlap(artifactRoot, secretsRoot)) {
    pathFailure("recovery_roots_invalid");
  }
  return { dataRoot, artifactRoot, secretsRoot };
}

function validateRelativeInput(value: unknown): string {
  if (!validPathText(value) || isAbsolute(value) || value === "." || value === "..") {
    pathFailure();
  }
  const segments = value.split(/[\\/]+/u);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    pathFailure();
  }
  return value;
}

export async function resolveContainedRegularFile(
  root: string,
  inputPath: string,
  purpose: string,
): Promise<string> {
  if (typeof purpose !== "string" || !purpose.trim() || purpose.length > 128) pathFailure();
  try {
    const canonicalRoot = canonicalDirectory(root);
    const relativePath = validateRelativeInput(inputPath);
    const candidate = resolve(canonicalRoot, relativePath);
    if (!contains(canonicalRoot, candidate) || candidate === canonicalRoot) pathFailure();
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) pathFailure();
    const canonicalFile = await realpath(candidate);
    if (!contains(canonicalRoot, canonicalFile) || canonicalFile === canonicalRoot) pathFailure();
    return canonicalFile;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    pathFailure();
  }
}
