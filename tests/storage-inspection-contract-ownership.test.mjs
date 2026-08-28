import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const statusInspectionPath = new URL("../src/storage/inspection/storage-inspect-cli.ts", import.meta.url);
const integrityInspectionPath = new URL("../src/storage/inspection/storage-integrity-inspect-cli.ts", import.meta.url);

const [statusSource, integritySource] = await Promise.all([
  readFile(statusInspectionPath, "utf8"),
  readFile(integrityInspectionPath, "utf8"),
]);

test("storage inspection CLIs consume canonical storage contracts directly", () => {
  assert.match(statusSource, /from "\.\.\/status\/storage-status-contract\.ts"/);
  assert.doesNotMatch(statusSource, /\.\.\/\.\.\/\.\.\/storage-status-contract\.ts/);

  assert.match(integritySource, /from "\.\.\/integrity\/storage-integrity-contract\.ts"/);
  assert.doesNotMatch(integritySource, /\.\.\/\.\.\/\.\.\/storage-integrity-contract\.ts/);
});
