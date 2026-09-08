import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function text(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("approval gates contract has one canonical integrations owner", () => {
  const canonical = text("docs/integrations/APPROVAL_GATES.md");
  const pointer = text("docs/APPROVAL_GATES.md");

  assert.match(canonical, /^# Approval-гейты опасных процессов XYOps/m);
  assert.match(canonical, /принцип четырёх глаз/);
  assert.match(canonical, /POST \/api\/integrations\/approvals\/:id\/execute/);
  assert.match(canonical, /xyops\.approve/);
  assert.match(canonical, /CONFIG_ENCRYPTION_KEY/);

  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /\[`integrations\/APPROVAL_GATES\.md`\]\(integrations\/APPROVAL_GATES\.md\)/);
  assert.match(pointer, /compatibility pointer/);
});

test("active navigation and source-reading contract resolve approval gates to integrations", () => {
  const integrationsIndex = text("docs/integrations/README.md");
  const docsIndex = text("docs/README.md");
  const inventory = text("docs/DOCUMENTATION_INVENTORY.md");
  const agentContract = text("tests/ai-agent-workflow-contract.test.mjs");

  assert.match(integrationsIndex, /\[`APPROVAL_GATES\.md`\]\(APPROVAL_GATES\.md\)/);
  assert.match(docsIndex, /\[`APPROVAL_GATES\.md`\]\(integrations\/APPROVAL_GATES\.md\)/);
  assert.match(inventory, /`docs\/integrations\/APPROVAL_GATES\.md`[^\n]+`verified-active`/);
  assert.match(agentContract, /docs\/integrations\/APPROVAL_GATES\.md/);
  assert.doesNotMatch(agentContract, /docs\/APPROVAL_GATES\.md/);
});
