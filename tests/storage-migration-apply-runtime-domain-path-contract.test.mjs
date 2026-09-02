import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const contextPath = "src/storage/migration/apply/storage-migration-apply-context.ts";
const executorPath = "src/storage/migration/apply/storage-migration-apply-executor.ts";

test("storage migration apply runtime has canonical storage-domain ownership", async () => {
  await access(new URL(`../${contextPath}`, import.meta.url));
  await access(new URL(`../${executorPath}`, import.meta.url));

  assert.equal(
    await read("storage-migration-apply-context.ts"),
    'export * from "./src/storage/migration/apply/storage-migration-apply-context.ts";\n',
    "root apply context must remain an exact compatibility shim",
  );
  assert.equal(
    await read("storage-migration-apply-executor.ts"),
    'export * from "./src/storage/migration/apply/storage-migration-apply-executor.ts";\n',
    "root apply executor must remain an exact compatibility shim",
  );

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
