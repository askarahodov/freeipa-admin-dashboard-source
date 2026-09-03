import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canonicalPath = new URL("../src/backup/preview/backup-import-preview.ts", import.meta.url);
const compatibilityPath = new URL("../backup-import-preview.ts", import.meta.url);

test("backup import preview implementation is canonical under src/backup/preview", async () => {
  const canonical = await readFile(canonicalPath, "utf8");
  const compatibility = await readFile(compatibilityPath, "utf8");

  assert.match(canonical, /export async function validateBackupImportDocument/);
  assert.match(canonical, /export async function previewBackupImport/);
  assert.match(canonical, /from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/);
  assert.match(canonical, /from "\.\.\/export\/backup-export\.ts"/);
  assert.equal(
    compatibility.trim(),
    'export * from "./src/backup/preview/backup-import-preview.ts";',
  );
});
