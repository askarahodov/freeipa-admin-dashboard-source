import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function text(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("stable error-code ownership has one canonical reference owner", () => {
  const canonical = text("docs/reference/ERROR_CODE_OWNERSHIP.md");
  const pointer = text("docs/ERROR_CODE_OWNERSHIP.md");
  assert.match(canonical, /^# Stable error-code ownership/m);
  assert.match(canonical, /src\/auth\/stable-error-contract\.ts/);
  assert.match(canonical, /docs\/reference\/ERROR_CODES\.md/);
  assert.match(canonical, /tests\/stable-error-contract\.test\.mjs/);
  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /reference\/ERROR_CODE_OWNERSHIP\.md/);
  assert.match(pointer, /compatibility pointer/);
});

test("reference navigation, docs index and inventory point to the canonical owner", () => {
  const reference = text("docs/reference/README.md");
  const index = text("docs/README.md");
  const inventory = text("docs/DOCUMENTATION_INVENTORY.md");
  assert.match(reference, /\[`ERROR_CODE_OWNERSHIP\.md`\]\(ERROR_CODE_OWNERSHIP\.md\)/);
  assert.equal((reference.match(/ERROR_CODE_OWNERSHIP\.md/g) || []).length, 2);
  assert.match(index, /reference\/ERROR_CODE_OWNERSHIP\.md/);
  assert.match(inventory, /`docs\/reference\/ERROR_CODE_OWNERSHIP\.md`[^\n]+`verified-active`/);
});
