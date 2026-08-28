import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [canonicalSource, rootSource, workerSource] = await Promise.all([
  readFile(new URL("../src/storage/integrity/storage-integrity.ts", import.meta.url), "utf8"),
  readFile(new URL("../storage-integrity.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/storage-integrity-entry.ts", import.meta.url), "utf8"),
]);

test("storage integrity service has canonical domain ownership with an exact root shim", () => {
  assert.match(canonicalSource, /export function inspectStorageIntegrity/);
  assert.match(canonicalSource, /export function unavailableStorageIntegrityReport/);
  assert.equal(
    rootSource,
    'export * from "./src/storage/integrity/storage-integrity.ts";\n',
  );
});

test("storage integrity runtime entry consumes the canonical implementation", () => {
  assert.match(
    workerSource,
    /from ["']\.\.\/src\/storage\/integrity\/storage-integrity\.ts["']/,
  );
  assert.equal(workerSource.includes('from "../storage-integrity.ts"'), false);
});
