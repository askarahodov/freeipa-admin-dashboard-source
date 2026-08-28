import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const canonicalPath = "src/storage/integrity/storage-integrity-contract.ts";
const legacyPath = "storage-integrity-contract.ts";
const exactShim = 'export * from "./src/storage/integrity/storage-integrity-contract.ts";\n';

test("storage integrity contract has canonical storage-domain ownership", async () => {
  await access(new URL(`../${canonicalPath}`, import.meta.url));
  const source = await read(canonicalPath);
  assert.match(
    source,
    /export const STORAGE_INTEGRITY_PATH = ["']\/api\/admin\/storage\/integrity\/check["'] as const;/,
    "canonical storage integrity route must remain unchanged",
  );
  assert.match(source, /export type StorageIntegrityReport = \{/);
});

test("root storage integrity contract remains an exact compatibility shim", async () => {
  assert.equal(await read(legacyPath), exactShim);
});
