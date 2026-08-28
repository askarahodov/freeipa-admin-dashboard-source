import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(relativePath) {
  try { await stat(path.join(repoRoot, relativePath)); return true; } catch { return false; }
}

test("storage inspection CLI implementations live only under the canonical storage inspection domain", async () => {
  for (const name of ["storage-inspect-cli.ts", "storage-integrity-inspect-cli.ts"]) {
    assert.equal(await exists(`src/storage/inspection/${name}`), true, name);
    assert.equal(await exists(name), false, name);
  }
});
