import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("sanitized backup domain exporters remain read-only and secret-free", async () => {
  const exporterSource = await source("backup-export-domains.ts");
  assert.doesNotMatch(exporterSource, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX)\b/i);
  assert.doesNotMatch(exporterSource, /SELECT\s+\*/i);
  assert.doesNotMatch(exporterSource, /\bfetch\s*\(/);
  assert.doesNotMatch(exporterSource, /config_encryption_key|encrypted_secrets|password_hash|password_salt|token_hash|session_token|reset_token|encrypted_spec/i);
});

test("backup orchestration does not mutate data or call upstream services", async () => {
  const orchestrationSource = await source("src/backup/export/backup-export.ts");
  assert.doesNotMatch(orchestrationSource, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX)\b/i);
  assert.doesNotMatch(orchestrationSource, /\bfetch\s*\(/);
});
