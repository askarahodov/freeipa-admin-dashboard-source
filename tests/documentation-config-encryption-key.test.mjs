import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function text(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("encryption-key security contract has one canonical documentation owner", () => {
  const canonical = text("docs/security/CONFIG_ENCRYPTION_KEY.md");
  const pointer = text("docs/CONFIG_ENCRYPTION_KEY.md");
  const securityIndex = text("docs/security/README.md");

  assert.match(canonical, /^# CONFIG_ENCRYPTION_KEY operations/m);
  assert.match(canonical, /AES-256-GCM root key/);
  assert.match(canonical, /Production startup must receive it from external configuration/);
  assert.match(canonical, /Changing the key is \*\*not\*\* a rotation procedure/);
  assert.match(canonical, /must never expose the key/);

  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /\[`security\/CONFIG_ENCRYPTION_KEY\.md`\]\(security\/CONFIG_ENCRYPTION_KEY\.md\)/);
  assert.match(pointer, /compatibility pointer/);

  assert.match(securityIndex, /\[`CONFIG_ENCRYPTION_KEY\.md`\]\(CONFIG_ENCRYPTION_KEY\.md\)/);
});

test("active navigation resolves encryption-key policy to docs/security", () => {
  const root = text("README.md");
  const docsIndex = text("docs/README.md");
  const inventory = text("docs/DOCUMENTATION_INVENTORY.md");
  const securityModel = text("docs/security/SECURITY_MODEL.md");

  assert.match(root, /\[`docs\/security\/CONFIG_ENCRYPTION_KEY\.md`\]\(docs\/security\/CONFIG_ENCRYPTION_KEY\.md\)/);
  assert.match(docsIndex, /\[`CONFIG_ENCRYPTION_KEY\.md`\]\(security\/CONFIG_ENCRYPTION_KEY\.md\)/);
  assert.match(inventory, /`docs\/security\/CONFIG_ENCRYPTION_KEY\.md`[^\n]+`verified-active`/);
  assert.match(securityModel, /\[`CONFIG_ENCRYPTION_KEY\.md`\]\(CONFIG_ENCRYPTION_KEY\.md\)/);
});
