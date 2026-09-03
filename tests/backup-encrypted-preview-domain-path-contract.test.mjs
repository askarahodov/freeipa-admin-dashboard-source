import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const canonicalPath = new URL("../src/backup/preview/backup-encrypted-preview.ts", import.meta.url);
const compatibilityPath = new URL("../backup-encrypted-preview.ts", import.meta.url);

test("backup encrypted preview implementation is canonical under src/backup/preview", async () => {
  const canonical = await readFile(canonicalPath, "utf8");
  assert.match(canonical, /export async function validateEncryptedBackupDocument/);
  assert.match(canonical, /export async function decryptEncryptedBackupDocument/);
  assert.match(canonical, /export async function previewEncryptedBackupImport/);
  assert.match(canonical, /from "\.\.\/export\/backup-encrypted-export\.ts"/);
  await assert.rejects(() => access(compatibilityPath), { code: "ENOENT" });
});
