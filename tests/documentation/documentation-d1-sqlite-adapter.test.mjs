import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function text(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("D1 SQLite adapter contract has one canonical architecture owner", () => {
  const canonical = text("docs/architecture/D1_SQLITE_ADAPTER.md");
  const pointer = text("docs/D1_SQLITE_ADAPTER.md");

  assert.match(canonical, /^# Local D1-compatible SQLite adapter/m);
  assert.match(canonical, /runtime\/d1-sqlite-adapter\.mjs/);
  assert.match(canonical, /batch\(\)/);
  assert.match(canonical, /\/data\/portal\.sqlite/);

  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /\[`architecture\/D1_SQLITE_ADAPTER\.md`\]\(architecture\/D1_SQLITE_ADAPTER\.md\)/);
  assert.match(pointer, /compatibility pointer/);
});

test("D1 SQLite adapter contract is exposed by canonical navigation", () => {
  const architectureIndex = text("docs/architecture/README.md");
  const docsIndex = text("docs/README.md");
  const inventory = text("docs/DOCUMENTATION_INVENTORY.md");
  const runtimeIndex = text("runtime/README.md");

  assert.match(architectureIndex, /\[`D1_SQLITE_ADAPTER\.md`\]\(D1_SQLITE_ADAPTER\.md\)/);
  assert.match(docsIndex, /\[`D1_SQLITE_ADAPTER\.md`\]\(architecture\/D1_SQLITE_ADAPTER\.md\)/);
  assert.match(inventory, /`docs\/architecture\/D1_SQLITE_ADAPTER\.md`[^\n]+`verified-active`/);
  assert.match(runtimeIndex, /docs\/architecture\/D1_SQLITE_ADAPTER\.md/);
});
