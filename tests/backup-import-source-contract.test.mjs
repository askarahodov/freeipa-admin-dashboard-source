import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("backup import preflight core and route remain read-only and offline", async () => {
  const combined = [
    await source("backup-import-preview.ts"),
    await source("worker/backup-import-preview-entry.ts"),
    await source("worker/backup-import-preview-root-entry.ts"),
  ].join("\n");

  assert.doesNotMatch(combined, /[\"'`]\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX|VACUUM)\b/i);
  assert.doesNotMatch(combined, /SELECT\s+\*/i);
  assert.doesNotMatch(combined, /(?:await|return|=)\s+fetch\s*\(/);
  assert.doesNotMatch(combined, /maintenance(?:Mode|_mode)|restore(?:Commit|_commit)|encrypted_secrets|password_hash|password_salt|session_token|reset_token|encrypted_spec/i);
});

test("preview audit source does not persist payloads or conflict row contents", async () => {
  const route = await source("worker/backup-import-preview-entry.ts");
  assert.doesNotMatch(route, /metadata\s*:\s*\{[^}]*payloads?/s);
  assert.doesNotMatch(route, /metadata\s*:\s*\{[^}]*conflicts?/s);
  assert.doesNotMatch(route, /JSON\.stringify\([^)]*document\.payloads/);
});
