import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("locked migration preflight has one canonical src owner", async () => {
  const canonical = await read("src/storage/migration/preflight/storage-migration-locked-preflight.ts");

  assert.match(canonical, /export async function inspectStorageMigrationPreflightWithOwnedLock/);
  assert.match(canonical, /from "\.\/storage-migration-preflight-contract\.ts"/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/\.\.\/db\/portal-migration-lock\.ts"/);
  await assert.rejects(
    access(new URL("../storage-migration-locked-preflight.ts", import.meta.url)),
    "root locked-preflight compatibility shim must be removed",
  );
});
