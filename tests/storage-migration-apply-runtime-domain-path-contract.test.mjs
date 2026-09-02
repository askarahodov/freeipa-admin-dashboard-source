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

const contextPath = "src/storage/migration/apply/storage-migration-apply-context.ts";
const executorPath = "src/storage/migration/apply/storage-migration-apply-executor.ts";

test("storage migration apply runtime has canonical storage-domain ownership", async () => {
  assert.equal(await exists(contextPath), true);
  assert.equal(await exists(executorPath), true);
  assert.equal(await exists("storage-migration-apply-context.ts"), false);
  assert.equal(await exists("storage-migration-apply-executor.ts"), false);

  const context = await read(contextPath);
  assert.match(context, /from ["']\.\.\/operation\/storage-migration-operation\.ts["'];/);
  assert.match(context, /from ["']\.\.\/operation\/storage-migration-operation-repository\.ts["'];/);
  assert.match(context, /from ["']\.\.\/preflight\/storage-migration-locked-preflight\.ts["'];/);
  assert.match(context, /from ["']\.\.\/preflight\/storage-migration-preflight-contract\.ts["'];/);
  assert.match(context, /from ["']\.\.\/\.\.\/integrity\/storage-quick-check\.ts["'];/);

  const executor = await read(executorPath);
  assert.match(executor, /from ["']\.\/storage-migration-apply-context\.ts["'];/);
  assert.doesNotMatch(executor, /from ["'](?:\.\.\/)+storage-migration-apply-context\.ts["'];/);
});
