import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = async (path) => {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

test("storage quick-check has one canonical integrity-domain owner", async () => {
  const [canonical, integrity] = await Promise.all([
    read("src/storage/integrity/storage-quick-check.ts"),
    read("src/storage/integrity/storage-integrity.ts"),
  ]);

  assert.equal(await exists("storage-quick-check.ts"), false, "root quick-check shim must be removed");
  assert.match(canonical, /export async function inspectStorageQuickCheck/);
  assert.match(canonical, /PRAGMA quick_check\(1\)/);
  assert.match(
    integrity,
    /from "\.\/storage-quick-check\.ts";/,
    "storage integrity must consume the canonical quick-check module",
  );
  assert.doesNotMatch(
    integrity,
    /from "\.\.\/\.\.\/\.\.\/storage-quick-check\.ts";/,
    "storage integrity must not regress to the removed root shim",
  );
});
