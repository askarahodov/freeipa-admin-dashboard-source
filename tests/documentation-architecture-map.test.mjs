import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("architecture and project structure are active documentation entrypoints", () => {
  const architecture = read("docs/ARCHITECTURE.md");
  const projectStructure = read("docs/PROJECT_STRUCTURE.md");
  const index = read("docs/README.md");
  const inventory = read("docs/DOCUMENTATION_INVENTORY.md");
  const aiEntrypoint = read("docs/ai/README.md");

  assert.match(architecture, /^# Architecture/m);
  assert.match(projectStructure, /^# Project structure and module boundaries/m);

  assert.match(index, /\[ARCHITECTURE\.md\]\(ARCHITECTURE\.md\)/);
  assert.match(index, /\[PROJECT_STRUCTURE\.md\]\(PROJECT_STRUCTURE\.md\)/);

  assert.match(aiEntrypoint, /\[ARCHITECTURE\.md\]\(\.\.\/ARCHITECTURE\.md\)/);
  assert.match(aiEntrypoint, /\[PROJECT_STRUCTURE\.md\]\(\.\.\/PROJECT_STRUCTURE\.md\)/);

  assert.match(inventory, /`docs\/ARCHITECTURE\.md`[\s\S]*`verified-active`/);
  assert.match(inventory, /`docs\/PROJECT_STRUCTURE\.md`[\s\S]*`verified-active`/);

  assert.doesNotMatch(index, /`ARCHITECTURE\.md`;\s*\n- `PROJECT_STRUCTURE\.md`/);
  assert.doesNotMatch(aiEntrypoint, /Architecture overview, project structure .*will be added/i);
});
