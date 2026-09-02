import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/storage-migration-apply-entry.ts", import.meta.url), "utf8");

test("storage migration apply worker consumes canonical apply owners", () => {
  assert.match(source, /from ["']\.\.\/src\/storage\/migration\/apply\/storage-migration-apply-contract\.ts["']/);
  assert.match(source, /from ["']\.\.\/src\/storage\/migration\/apply\/storage-migration-apply\.ts["']/);
  assert.equal(/from ["']\.\.\/storage-migration-apply-contract\.ts["']/.test(source), false);
  assert.equal(/from ["']\.\.\/storage-migration-apply\.ts["']/.test(source), false);
});
