import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const canonicalPath = "src/storage/migration/apply/storage-migration-apply-contract.ts";
const rootPath = "storage-migration-apply-contract.ts";

test("storage migration apply contract has canonical domain ownership", async () => {
  const [canonical, compatibility] = await Promise.all([
    readFile(new URL(canonicalPath, root), "utf8"),
    readFile(new URL(rootPath, root), "utf8"),
  ]);

  assert.equal(
    compatibility,
    'export * from "./src/storage/migration/apply/storage-migration-apply-contract.ts";\n',
  );
  assert.match(canonical, /from "\.\.\/operation\/storage-migration-operation\.ts"/);
  assert.match(canonical, /STORAGE_MIGRATION_APPLY_PATH = "\/api\/admin\/storage\/migrations\/apply"/);
  assert.match(canonical, /STORAGE_MIGRATION_APPLY_STATUS_PATH = "\/api\/admin\/storage\/migrations\/apply\/status"/);
  assert.match(canonical, /STORAGE_MIGRATION_RECONCILE_PATH = "\/api\/admin\/storage\/migrations\/apply\/reconcile"/);
});
