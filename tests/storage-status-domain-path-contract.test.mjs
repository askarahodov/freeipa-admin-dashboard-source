import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

test("storage status contract has one canonical domain implementation and a thin root shim", async () => {
  const canonical = "src/storage/status/storage-status-contract.ts";
  const legacyRoot = "storage-status-contract.ts";

  assert.equal(await exists(canonical), true, `missing canonical storage status contract: ${canonical}`);
  assert.equal(
    await readFile(path.join(repoRoot, legacyRoot), "utf8"),
    'export * from "./src/storage/status/storage-status-contract.ts";\n',
    "root storage status contract must remain an exact compatibility re-export",
  );

  assert.equal(
    await readFile(path.join(repoRoot, canonical), "utf8"),
    'export const STORAGE_STATUS_PATH = "/api/admin/storage/status" as const;\n',
    "canonical storage status contract changed unexpectedly during the structural move",
  );
});
