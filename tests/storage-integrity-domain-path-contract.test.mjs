import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = async (path) => {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

const canonicalPath = "src/storage/integrity/storage-integrity-contract.ts";
const legacyPath = "storage-integrity-contract.ts";

test("storage integrity contract has canonical storage-domain ownership", async () => {
  await access(new URL(`../${canonicalPath}`, import.meta.url));
  assert.equal(await exists(legacyPath), false, "root storage integrity contract shim must be removed");
  const source = await read(canonicalPath);
  assert.match(
    source,
    /export const STORAGE_INTEGRITY_PATH = ["']\/api\/admin\/storage\/integrity\/check["'] as const;/,
    "canonical storage integrity route must remain unchanged",
  );
  assert.match(source, /export type StorageIntegrityReport = \{/);
});
