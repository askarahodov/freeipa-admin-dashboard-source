import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const operationCanonicalPath = "src/storage/migration/operation/storage-migration-operation.ts";
const operationLegacyPath = "storage-migration-operation.ts";
const repositoryCanonicalPath = "src/storage/migration/operation/storage-migration-operation-repository.ts";
const repositoryLegacyPath = "storage-migration-operation-repository.ts";

test("storage migration operation family has canonical storage-domain ownership", async () => {
  await access(new URL(`../${operationCanonicalPath}`, import.meta.url));
  await access(new URL(`../${repositoryCanonicalPath}`, import.meta.url));

  assert.equal(
    await read(operationLegacyPath),
    'export * from "./src/storage/migration/operation/storage-migration-operation.ts";\n',
    "root storage migration operation entrypoint must remain an exact compatibility shim",
  );
  assert.equal(
    await read(repositoryLegacyPath),
    'export * from "./src/storage/migration/operation/storage-migration-operation-repository.ts";\n',
    "root storage migration operation repository entrypoint must remain an exact compatibility shim",
  );

  const repositorySource = await read(repositoryCanonicalPath);
  assert.match(
    repositorySource,
    /from ["']\.\/storage-migration-operation\.ts["'];/,
    "canonical operation repository must consume the canonical sibling operation contract",
  );
  assert.doesNotMatch(
    repositorySource,
    /from ["'](?:\.\.\/)+storage-migration-operation\.ts["'];/,
    "canonical operation repository must not depend on the root compatibility shim",
  );
});
