import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function exists(path) {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

const operationCanonicalPath = "src/storage/migration/operation/storage-migration-operation.ts";
const operationLegacyPath = "storage-migration-operation.ts";
const repositoryCanonicalPath = "src/storage/migration/operation/storage-migration-operation-repository.ts";
const repositoryLegacyPath = "storage-migration-operation-repository.ts";

test("storage migration operation family has canonical storage-domain ownership", async () => {
  assert.equal(await exists(operationCanonicalPath), true);
  assert.equal(await exists(repositoryCanonicalPath), true);
  assert.equal(await exists(operationLegacyPath), false);
  assert.equal(await exists(repositoryLegacyPath), false);

  const repositorySource = await read(repositoryCanonicalPath);
  assert.match(
    repositorySource,
    /from ["']\.\/storage-migration-operation\.ts["'];/,
    "canonical operation repository must consume the canonical sibling operation contract",
  );
  assert.doesNotMatch(
    repositorySource,
    /from ["'](?:\.\.\/)+storage-migration-operation\.ts["'];/,
    "canonical operation repository must not depend on a root compatibility shim",
  );
});
