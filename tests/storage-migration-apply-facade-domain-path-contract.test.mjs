import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [canonicalSource, rootSource] = await Promise.all([
  readFile(new URL("../src/storage/migration/apply/storage-migration-apply.ts", import.meta.url), "utf8"),
  readFile(new URL("../storage-migration-apply.ts", import.meta.url), "utf8"),
]);

test("storage migration apply facade has one canonical src owner", () => {
  assert.equal(
    rootSource,
    'export * from "./src/storage/migration/apply/storage-migration-apply.ts";\n',
  );
  assert.match(canonicalSource, /export async function applyControlledStorageMigrations\(/);
  assert.match(canonicalSource, /export async function reconcileControlledStorageMigration\(/);
  assert.match(canonicalSource, /from ["']\.\.\/operation\/storage-migration-operation-repository\.ts["']/);
  assert.match(canonicalSource, /from ["']\.\.\/\.\.\/integrity\/storage-quick-check\.ts["']/);
  assert.match(canonicalSource, /from ["']\.\/storage-migration-apply-context\.ts["']/);
  assert.equal(/from ["']\.\/storage-migration-operation/.test(canonicalSource), false);
  assert.equal(/from ["']\.\/storage-quick-check\.ts["']/.test(canonicalSource), false);
});
