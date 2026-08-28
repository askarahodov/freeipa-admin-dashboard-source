import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const statusScriptPath = new URL("../scripts/storage-inspect.ts", import.meta.url);
const integrityScriptPath = new URL("../scripts/storage-integrity-inspect.ts", import.meta.url);
const statusRootShimPath = new URL("../storage-inspect-cli.ts", import.meta.url);
const integrityRootShimPath = new URL("../storage-integrity-inspect-cli.ts", import.meta.url);

const [statusScript, integrityScript] = await Promise.all([
  readFile(statusScriptPath, "utf8"),
  readFile(integrityScriptPath, "utf8"),
]);

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

test("storage inspection entrypoints consume canonical src owners without root CLI shims", async () => {
  assert.match(statusScript, /from "\.\.\/src\/storage\/inspection\/storage-inspect-cli\.ts";/);
  assert.match(integrityScript, /from "\.\.\/src\/storage\/inspection\/storage-integrity-inspect-cli\.ts";/);
  assert.equal(statusScript.includes("../storage-inspect-cli.ts"), false);
  assert.equal(integrityScript.includes("../storage-integrity-inspect-cli.ts"), false);
  assert.equal(await exists(statusRootShimPath), false);
  assert.equal(await exists(integrityRootShimPath), false);
});
