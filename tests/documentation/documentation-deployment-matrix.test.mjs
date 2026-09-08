import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function text(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("deployment matrix has one canonical architecture owner", () => {
  const canonical = text("docs/architecture/DEPLOYMENT_MATRIX.md");
  const pointer = text("docs/DEPLOYMENT_MATRIX.md");

  assert.match(canonical, /^# Deployment support matrix/m);
  assert.match(canonical, /\*\*Supported production\*\*/);
  assert.match(canonical, /Docker Compose using repository `compose\.yaml`/);
  assert.match(canonical, /Kubernetes \/ Helm deployment/);

  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /\[`architecture\/DEPLOYMENT_MATRIX\.md`\]\(architecture\/DEPLOYMENT_MATRIX\.md\)/);
  assert.match(pointer, /compatibility pointer/);
});

test("active navigation resolves deployment policy to docs/architecture", () => {
  const architectureIndex = text("docs/architecture/README.md");
  const docsIndex = text("docs/README.md");
  const inventory = text("docs/DOCUMENTATION_INVENTORY.md");
  const runtimeIndex = text("runtime/README.md");
  const adrIndex = text("docs/adr/README.md");
  const persistenceAdr = text("docs/adr/ADR-0002-persistence-runtime.md");

  assert.equal((architectureIndex.match(/\[`DEPLOYMENT_MATRIX\.md`\]\(DEPLOYMENT_MATRIX\.md\)/g) ?? []).length, 1);
  assert.doesNotMatch(architectureIndex, /\[`\.\.\/DEPLOYMENT_MATRIX\.md`\]/);
  assert.match(docsIndex, /\[`DEPLOYMENT_MATRIX\.md`\]\(architecture\/DEPLOYMENT_MATRIX\.md\)/);
  assert.match(inventory, /`docs\/architecture\/DEPLOYMENT_MATRIX\.md`[^\n]+`verified-active`/);
  assert.match(runtimeIndex, /docs\/architecture\/DEPLOYMENT_MATRIX\.md/);
  assert.match(adrIndex, /docs\/architecture\/DEPLOYMENT_MATRIX\.md/);
  assert.match(persistenceAdr, /docs\/architecture\/DEPLOYMENT_MATRIX\.md/);
});
