import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateProductionEncryptionKey } from "../scripts/config-encryption-key.mjs";

const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");

const publishedComposeKey = "d0ee92e4c9b6b9e1282d4808ff08e03de28087b1b0b3b5f44198f7bdbe782ec5";
const validHex = "7f6a5d4c3b2a1908ffeeddccbbaa99887766554433221100a1b2c3d4e5f60718";
const validBase64 = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64");

function dashboardService(source) {
  const match = /(?:^|\n)  dashboard:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|\nvolumes:\n|$)/u.exec(source);
  assert.ok(match, "dashboard service must exist");
  return match[1];
}

test("production Compose requires CONFIG_ENCRYPTION_KEY from external configuration", () => {
  const service = dashboardService(compose);
  assert.match(service, /CONFIG_ENCRYPTION_KEY:\s*\$\{CONFIG_ENCRYPTION_KEY:\?[^\n]+\}/u);
  assert.doesNotMatch(service, new RegExp(publishedComposeKey, "u"));
});

test("production encryption key accepts exact 32-byte hex or base64", () => {
  assert.equal(validateProductionEncryptionKey(validHex), validHex);
  assert.equal(validateProductionEncryptionKey(`  ${validBase64}  `), validBase64);
});

test("production encryption key rejects missing, malformed, placeholder and wrong-sized values", () => {
  for (const value of [
    undefined,
    "",
    "replace-with-a-random-64-character-hex-key",
    "not-base64-or-hex",
    Buffer.alloc(31, 1).toString("base64"),
    Buffer.alloc(33, 1).toString("base64"),
  ]) {
    assert.throws(() => validateProductionEncryptionKey(value), /CONFIG_ENCRYPTION_KEY/u);
  }
});

test("production encryption key rejects the previously published key and trivially weak keys", () => {
  for (const value of [publishedComposeKey, "0".repeat(64), "11".repeat(32), "ff".repeat(32)]) {
    assert.throws(() => validateProductionEncryptionKey(value), /CONFIG_ENCRYPTION_KEY/u);
  }
});
