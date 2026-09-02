import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const productionFiles = [
  "backup-encryption.ts",
  "backup-full-domains.ts",
  "backup-encrypted-export.ts",
  "src/backup/preview/backup-full-projections.ts",
  "backup-encrypted-preview.ts",
  "worker/backup-encrypted-export-entry.ts",
  "worker/backup-encrypted-preview-entry.ts",
  "worker/backup-encrypted-root-entry.ts",
];

async function sources() {
  return Promise.all(productionFiles.map(async (path) => ({ path, text: await readFile(new URL(`../${path}`, import.meta.url), "utf8") })));
}

test("encrypted backup production code contains no mutation or maintenance path", async () => {
  for (const { path, text } of await sources()) {
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX)\b/i, path);
    assert.doesNotMatch(text, /SELECT\s+\*/i, path);
    assert.doesNotMatch(text, /maintenance[_ -]?mode/i, path);
    assert.doesNotMatch(text, /\/restore(?:\/|\b)|restore[_ -]?commit/i, path);
    assert.doesNotMatch(text, /CONFIG_ENCRYPTION_KEY/i, path);
    assert.doesNotMatch(text, /console\.(?:log|info|warn|error|debug)/, path);
  }
});

test("only the crypto module invokes Web Crypto and no encrypted module calls upstream fetch", async () => {
  for (const { path, text } of await sources()) {
    if (path !== "backup-encryption.ts") assert.doesNotMatch(text, /crypto\.subtle/, path);
    assert.doesNotMatch(text, /\bfetch\s*\(/, path);
  }
});

test("route audit metadata excludes credentials and encrypted envelopes", async () => {
  for (const path of ["worker/backup-encrypted-export-entry.ts", "worker/backup-encrypted-preview-entry.ts"]) {
    const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const metadataBlocks = [...text.matchAll(/metadata:\s*\{([\s\S]*?)\n\s*\},/g)].map((match) => match[1]).join("\n");
    assert.doesNotMatch(metadataBlocks, /password|salt|\biv\b|ciphertext|sha256|derived|plaintext|encrypted_secrets|encrypted_spec/i, path);
  }
});
