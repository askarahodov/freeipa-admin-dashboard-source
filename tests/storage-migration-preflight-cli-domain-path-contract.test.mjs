import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const canonicalPath = "src/storage/migration/preflight/storage-migration-preflight-inspect-cli.ts";
const legacyPath = "storage-migration-preflight-inspect-cli.ts";
const scriptPath = "scripts/storage-migration-preflight-inspect.ts";

test("storage migration preflight CLI has canonical storage-domain ownership", async () => {
  await access(new URL(`../${canonicalPath}`, import.meta.url));
  assert.equal(
    await read(legacyPath),
    'export * from "./src/storage/migration/preflight/storage-migration-preflight-inspect-cli.ts";\n',
    "root preflight CLI entrypoint must remain an exact compatibility shim",
  );

  const script = await read(scriptPath);
  assert.match(
    script,
    /from ["']\.\.\/src\/storage\/migration\/preflight\/storage-migration-preflight-inspect-cli\.ts["'];/,
    "operator script must consume canonical preflight CLI",
  );
  assert.doesNotMatch(
    script,
    /from ["']\.\.\/storage-migration-preflight-inspect-cli\.ts["'];/,
    "operator script must not consume the root compatibility shim",
  );

  const source = await read(canonicalPath);
  assert.match(
    source,
    /from ["']\.\/storage-migration-preflight-contract\.ts["'];/,
    "canonical preflight CLI must consume the canonical sibling contract",
  );
  assert.doesNotMatch(
    source,
    /from ["'](?:\.\.\/)+storage-migration-preflight-contract\.ts["'];/,
    "canonical preflight CLI must not depend on the root contract shim",
  );
});
