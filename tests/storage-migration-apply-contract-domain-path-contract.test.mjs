import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const canonicalPath = "src/storage/migration/apply/storage-migration-apply-contract.ts";
const rootPath = "storage-migration-apply-contract.ts";

async function exists(path) {
  try {
    await access(new URL(path, root));
    return true;
  } catch {
    return false;
  }
}

test("storage migration apply contract has canonical domain ownership", async () => {
  assert.equal(await exists(canonicalPath), true);
  assert.equal(await exists(rootPath), false);

  const canonical = await readFile(new URL(canonicalPath, root), "utf8");
  assert.match(canonical, /from "\.\.\/operation\/storage-migration-operation\.ts"/);
  assert.match(canonical, /STORAGE_MIGRATION_APPLY_PATH = "\/api\/admin\/storage\/migrations\/apply"/);
  assert.match(canonical, /STORAGE_MIGRATION_APPLY_STATUS_PATH = "\/api\/admin\/storage\/migrations\/apply\/status"/);
  assert.match(canonical, /STORAGE_MIGRATION_RECONCILE_PATH = "\/api\/admin\/storage\/migrations\/apply\/reconcile"/);
});
