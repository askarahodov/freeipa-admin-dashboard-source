import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

const canonicalUrl = new URL("../src/storage/migration/apply/storage-migration-apply.ts", import.meta.url);
const legacyRootUrl = new URL("../storage-migration-apply.ts", import.meta.url);
const canonicalSource = await readFile(canonicalUrl, "utf8");

test("storage migration apply facade has one canonical src owner", async () => {
  await assert.rejects(access(legacyRootUrl));
  assert.match(canonicalSource, /export async function applyControlledStorageMigrations\(/);
  assert.match(canonicalSource, /export async function reconcileControlledStorageMigration\(/);
  assert.match(canonicalSource, /from ["']\.\.\/operation\/storage-migration-operation-repository\.ts["']/);
  assert.match(canonicalSource, /from ["']\.\.\/\.\.\/integrity\/storage-quick-check\.ts["']/);
  assert.match(canonicalSource, /from ["']\.\/storage-migration-apply-context\.ts["']/);
  assert.equal(/from ["']\.\/storage-migration-operation/.test(canonicalSource), false);
  assert.equal(/from ["']\.\/storage-quick-check\.ts["']/.test(canonicalSource), false);
});
