import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("locked migration preflight has one canonical src owner", async () => {
  const [canonical, rootShim] = await Promise.all([
    read("src/storage/migration/preflight/storage-migration-locked-preflight.ts"),
    read("storage-migration-locked-preflight.ts"),
  ]);

  assert.match(canonical, /export async function inspectStorageMigrationPreflightWithOwnedLock/);
  assert.match(canonical, /from "\.\/storage-migration-preflight-contract\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/\.\.\/db\/portal-migration-lock\.ts"/);
  assert.equal(
    rootShim,
    'export * from "./src/storage/migration/preflight/storage-migration-locked-preflight.ts";\n',
  );
});
