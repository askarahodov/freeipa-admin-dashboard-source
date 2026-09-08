import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function text(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("deployment matrix has one canonical architecture owner", () => {
  const canonical = text("docs/architecture/DEPLOYMENT_MATRIX.md");
  const pointer = text("docs/DEPLOYMENT_MATRIX.md");
  assert.match(canonical, /^# Deployment support matrix/m);
  assert.match(canonical, /Supported production/);
  assert.match(canonical, /Kubernetes \/ Helm deployment/);
  assert.match(canonical, /PORTAL_DATA_DIR/);
  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /architecture\/DEPLOYMENT_MATRIX\.md/);
  assert.match(pointer, /compatibility pointer/);
});

test("deployment matrix is exposed by architecture navigation", () => {
  const architecture = text("docs/architecture/README.md");
  const index = text("docs/README.md");
  const inventory = text("docs/DOCUMENTATION_INVENTORY.md");
  assert.match(architecture, /\[`DEPLOYMENT_MATRIX\.md`\]\(DEPLOYMENT_MATRIX\.md\)/);
  assert.match(index, /\[`DEPLOYMENT_MATRIX\.md`\]\(architecture\/DEPLOYMENT_MATRIX\.md\)/);
  assert.match(inventory, /`docs\/architecture\/DEPLOYMENT_MATRIX\.md`[^\n]+`verified-active`/);
});
