import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const canonicalPath = "src/backup/preview/backup-full-projections.ts";
const legacyPath = "backup-full-projections.ts";

async function exists(path) {
  try {
    await access(new URL(path, root));
    return true;
  } catch {
    return false;
  }
}

test("full backup projections have canonical preview-domain ownership", async () => {
  assert.equal(await exists(canonicalPath), true);
  assert.equal(await exists(legacyPath), false);

  const source = await readFile(new URL(canonicalPath, root), "utf8");
  assert.match(source, /export function projectFullBackupDomain/);
  assert.match(source, /assertSanitizedBackupPayload\(result\)/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX)\b/i);
});
