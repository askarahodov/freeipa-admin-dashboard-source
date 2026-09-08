import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('project glossary has one canonical reference owner', () => {
  const canonical = read('docs/reference/GLOSSARY.md');
  const pointer = read('docs/GLOSSARY.md');
  const referenceIndex = read('docs/reference/README.md');
  const inventory = read('docs/DOCUMENTATION_INVENTORY.md');

  assert.match(canonical, /^# Project glossary/m);
  assert.match(canonical, /## Portal/);
  assert.match(canonical, /## Source of truth/);
  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /reference\/GLOSSARY\.md/);
  assert.match(referenceIndex, /\[`GLOSSARY\.md`\]\(GLOSSARY\.md\)/);
  assert.match(inventory, /`docs\/reference\/GLOSSARY\.md`/);
  assert.doesNotMatch(inventory, /`docs\/GLOSSARY\.md` \| active runtime\/domain semantics/);
});

test('documentation inventory records relocated canonical owners', () => {
  const inventory = read('docs/DOCUMENTATION_INVENTORY.md');

  for (const path of [
    'docs/security/LOCAL_AUTH_RBAC.md',
    'docs/operations/MAINTENANCE_MODE.md',
    'docs/operations/OFFLINE_FULL_RESTORE.md',
    'docs/operations/LOCAL_ACCEPTANCE_TESTS.md',
    'docs/operations/P0_OPERATIONAL_ACCEPTANCE.md',
  ]) {
    assert.ok(inventory.includes(`\`${path}\``), `${path} must be canonical in the inventory`);
  }
});
