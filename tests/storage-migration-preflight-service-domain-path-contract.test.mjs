import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("storage migration preflight service has one canonical src owner", async () => {
  const [canonical, rootShim, lockedPreflight] = await Promise.all([
    read("src/storage/migration/preflight/storage-migration-preflight.ts"),
    read("storage-migration-preflight.ts"),
    read("src/storage/migration/preflight/storage-migration-locked-preflight.ts"),
  ]);

  assert.match(canonical, /export function inspectStorageMigrationPreflight/);
  assert.match(canonical, /from "\.\/storage-migration-preflight-contract\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/integrity\/storage-quick-check\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/\.\.\/db\/portal-migrations-v3\.ts"/);
  assert.equal(
    rootShim,
    'export * from "./src/storage/migration/preflight/storage-migration-preflight.ts";\n',
  );
  assert.match(lockedPreflight, /from "\.\/storage-migration-preflight\.ts"/);
  assert.doesNotMatch(lockedPreflight, /\.\.\/\.\.\/\.\.\/\.\.\/storage-migration-preflight\.ts/);
});
