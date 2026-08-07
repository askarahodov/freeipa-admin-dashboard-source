import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateProductionEncryptionKey } from "../scripts/config-encryption-key.mjs";

const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");
const testCompose = await readFile(new URL("../compose.test.yaml", import.meta.url), "utf8");
const e2eCompose = await readFile(new URL("../compose.e2e.yaml", import.meta.url), "utf8");

const publishedComposeKey = "d0ee92e4c9b6b9e1282d4808ff08e03de28087b1b0b3b5f44198f7bdbe782ec5";
const validHex = "7f6a5d4c3b2a1908ffeeddccbbaa99887766554433221100a1b2c3d4e5f60718";
const validBase64 = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64");
const testFixtureKey = "1d787ea814fe48eb077f436970167c890f6c0ca737557b17e00252c27595ce71";
const e2eFixtureKey = "8e7f1cf2fd4232f71bb728883f8e716477fb43fb3a2fd293fe611b6d08eb7d95";

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

test("test and E2E Compose explicitly opt into isolated encryption-key profiles", () => {
  assert.match(dashboardService(testCompose), /PORTAL_RUNTIME_PROFILE:\s*test/u);
  assert.match(dashboardService(e2eCompose), /PORTAL_RUNTIME_PROFILE:\s*e2e/u);
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

test("documented test keys require an explicit isolated runtime profile", () => {
  for (const value of [testFixtureKey, e2eFixtureKey]) {
    assert.throws(() => validateProductionEncryptionKey(value), /test fixture/u);
  }
  assert.equal(validateProductionEncryptionKey(testFixtureKey, { profile: "test" }), testFixtureKey);
  assert.equal(validateProductionEncryptionKey(e2eFixtureKey, { profile: "e2e" }), e2eFixtureKey);
});
