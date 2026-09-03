import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const productionFiles = [
  "src/backup/crypto/backup-encryption.ts",
  "backup-full-domains.ts",
  "src/backup/export/backup-encrypted-export.ts",
  "src/backup/preview/backup-full-projections.ts",
  "src/backup/preview/backup-encrypted-preview.ts",
  "worker/backup-encrypted-export-entry.ts",
  "worker/backup-encrypted-preview-entry.ts",
  "worker/backup-encrypted-root-entry.ts",
];

async function sources() {
  return Promise.all(productionFiles.map(async (path) => ({ path, text: await readFile(new URL(`../${path}`, import.meta.url), "utf8") })));
}

test("backup encryption canonical owner exists without a root compatibility shim", async () => {
  await access(new URL("../src/backup/crypto/backup-encryption.ts", import.meta.url));
  await assert.rejects(access(new URL("../backup-encryption.ts", import.meta.url)));
});

test("encrypted preview canonical owner exists without a root compatibility shim", async () => {
  await access(new URL("../src/backup/preview/backup-encrypted-preview.ts", import.meta.url));
  await assert.rejects(access(new URL("../backup-encrypted-preview.ts", import.meta.url)));
});

test("encrypted backup production code contains no mutation or maintenance path", async () => {
  for (const { path, text } of await sources()) {
    const runtimeText = text
      .replaceAll("./src/backup/restore/backup-restore-selection.ts", "")
      .replaceAll("./src/backup/restore/backup-restore-plan.ts", "")
      .replaceAll("../restore/backup-restore-selection.ts", "")
      .replaceAll("../restore/backup-restore-plan.ts", "");
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REINDEX)\b/i, path);
    assert.doesNotMatch(text, /SELECT\s+\*/i, path);
    assert.doesNotMatch(text, /maintenance[_ -]?mode/i, path);
    assert.doesNotMatch(runtimeText, /\/restore(?:\/|\b)|restore[_ -]?commit/i, path);
    assert.doesNotMatch(text, /CONFIG_ENCRYPTION_KEY/i, path);
    assert.doesNotMatch(text, /console\.(?:log|info|warn|error|debug)/, path);
  }
});

test("only the crypto module invokes Web Crypto and no encrypted module calls upstream fetch", async () => {
  for (const { path, text } of await sources()) {
    if (path !== "src/backup/crypto/backup-encryption.ts") assert.doesNotMatch(text, /crypto\.subtle/, path);
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
