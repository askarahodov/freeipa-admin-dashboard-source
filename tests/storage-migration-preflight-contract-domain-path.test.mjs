import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const canonicalPath = "src/storage/migration/preflight/storage-migration-preflight-contract.ts";
const legacyPath = "storage-migration-preflight-contract.ts";

test("storage migration preflight contract has canonical storage-domain ownership", async () => {
  await access(new URL(`../${canonicalPath}`, import.meta.url));
  await assert.rejects(
    access(new URL(`../${legacyPath}`, import.meta.url)),
    { code: "ENOENT" },
  );

  const source = await read(canonicalPath);
  assert.match(
    source,
    /export const STORAGE_MIGRATION_PREFLIGHT_PATH = ["']\/api\/admin\/storage\/migrations\/preflight["'] as const;/,
    "canonical preflight route must remain unchanged",
  );
  assert.match(source, /export type StorageMigrationPreflightReport = \{/);
});
