import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(relativePath) {
  try { await stat(path.join(repoRoot, relativePath)); return true; } catch { return false; }
}

test("storage inspection CLI implementations live under the canonical storage inspection domain", async () => {
  const shims = {
    "storage-inspect-cli.ts": 'export * from "./src/storage/inspection/storage-inspect-cli.ts";\n',
    "storage-integrity-inspect-cli.ts": 'export * from "./src/storage/inspection/storage-integrity-inspect-cli.ts";\n',
  };
  for (const [name, expectedShim] of Object.entries(shims)) {
    assert.equal(await exists(`src/storage/inspection/${name}`), true, name);
    assert.equal(await readFile(path.join(repoRoot, name), "utf8"), expectedShim, name);
  }
});
