import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = async (path) => {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

test("storage integrity service has canonical domain ownership", async () => {
  const canonicalSource = await read("src/storage/integrity/storage-integrity.ts");
  assert.equal(await exists("storage-integrity.ts"), false, "root storage integrity service shim must be removed");
  assert.match(canonicalSource, /export function inspectStorageIntegrity/);
  assert.match(canonicalSource, /export function unavailableStorageIntegrityReport/);
});

test("storage integrity runtime entry consumes canonical implementation and contract", async () => {
  const workerSource = await read("worker/storage-integrity-entry.ts");
  assert.match(
    workerSource,
    /from ["']\.\.\/src\/storage\/integrity\/storage-integrity\.ts["']/,
  );
  assert.match(
    workerSource,
    /from ["']\.\.\/src\/storage\/integrity\/storage-integrity-contract\.ts["']/,
  );
  assert.equal(workerSource.includes('from "../storage-integrity.ts"'), false);
  assert.equal(workerSource.includes('from "../storage-integrity-contract.ts"'), false);
});
