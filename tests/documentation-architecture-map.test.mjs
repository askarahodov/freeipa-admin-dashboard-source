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

  assert.match(index, /\[`ARCHITECTURE\.md`\]\(ARCHITECTURE\.md\)/);
  assert.match(index, /\[`PROJECT_STRUCTURE\.md`\]\(PROJECT_STRUCTURE\.md\)/);

  assert.match(aiEntrypoint, /\[`ARCHITECTURE\.md`\]\(\.\.\/ARCHITECTURE\.md\)/);
  assert.match(aiEntrypoint, /\[`PROJECT_STRUCTURE\.md`\]\(\.\.\/PROJECT_STRUCTURE\.md\)/);

  assert.match(inventory, /`docs\/ARCHITECTURE\.md`[\s\S]*`verified-active`/);
  assert.match(inventory, /`docs\/PROJECT_STRUCTURE\.md`[\s\S]*`verified-active`/);

  assert.doesNotMatch(index, /`ARCHITECTURE\.md`;\s*\n- `PROJECT_STRUCTURE\.md`/);
  assert.doesNotMatch(aiEntrypoint, /Architecture overview, project structure .*will be added/i);
});

test("architecture map reflects the merged AppShell foundation without claiming Home integration", () => {
  const architecture = read("docs/ARCHITECTURE.md");
  const projectStructure = read("docs/PROJECT_STRUCTURE.md");

  assert.match(architecture, /reusable product shell\/navigation foundation under `app\/shell\/`/);
  assert.match(architecture, /not yet the primary Home composition/);
  assert.match(architecture, /`app\/page\.tsx` untouched/);
  assert.match(projectStructure, /\| `app\/shell\/` \| Reusable product shell and stable global navigation foundation/);
  assert.match(projectStructure, /Targeted Home\/AppShell integration remains follow-up work under #94/);

  assert.doesNotMatch(projectStructure, /AppShell\/navigation work tracked under #94\/#106 is not part of current runtime/);
  assert.doesNotMatch(architecture, /Draft AppShell work under #94\/#106 is not current runtime/);
});
