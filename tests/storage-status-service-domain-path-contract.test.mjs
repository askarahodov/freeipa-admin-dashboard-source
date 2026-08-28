import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function exists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

test("storage status service has one canonical status-domain owner", async () => {
  const canonicalPath = "src/storage/status/storage-status.ts";
  const rootPath = "storage-status.ts";
  const workerPath = "worker/storage-status-entry.ts";

  assert.equal(await exists(canonicalPath), true, `missing canonical storage status service: ${canonicalPath}`);
  assert.equal(
    await read(rootPath),
    'export * from "./src/storage/status/storage-status.ts";\n',
    "root storage status service must remain an exact compatibility re-export",
  );

  const canonical = await read(canonicalPath);
  assert.match(canonical, /export async function inspectStorageStatus\(/);
  assert.match(canonical, /from "\.\/storage-encryption-self-test\.ts";/);
  assert.equal(canonical.includes('from "../../../storage-encryption-self-test.ts"'), false);

  const worker = await read(workerPath);
  assert.match(worker, /from "\.\.\/src\/storage\/status\/storage-status\.ts";/);
  assert.equal(worker.includes('from "../storage-status.ts"'), false);
});
