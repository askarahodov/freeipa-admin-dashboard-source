import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("storage quick-check has one canonical integrity-domain owner", async () => {
  const [canonical, shim, integrity] = await Promise.all([
    read("src/storage/integrity/storage-quick-check.ts"),
    read("storage-quick-check.ts"),
    read("storage-integrity.ts"),
  ]);

  assert.equal(
    shim,
    'export * from "./src/storage/integrity/storage-quick-check.ts";\n',
    "root quick-check module must remain an exact compatibility re-export",
  );
  assert.match(canonical, /export async function inspectStorageQuickCheck/);
  assert.match(canonical, /PRAGMA quick_check\(1\)/);
  assert.match(
    integrity,
    /from "\.\/src\/storage\/integrity\/storage-quick-check\.ts";/,
    "storage integrity must consume the canonical quick-check module",
  );
  assert.doesNotMatch(
    integrity,
    /from "\.\/storage-quick-check\.ts";/,
    "storage integrity must not regress to the root compatibility shim",
  );
});
