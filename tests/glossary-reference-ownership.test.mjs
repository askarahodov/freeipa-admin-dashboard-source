import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('project glossary has one canonical reference owner', () => {
  const canonical = read('docs/reference/GLOSSARY.md');
  const pointer = read('docs/GLOSSARY.md');
  const referenceIndex = read('docs/reference/README.md');
  const docsIndex = read('docs/README.md');
  const inventory = read('docs/DOCUMENTATION_INVENTORY.md');

  assert.match(canonical, /^# Project glossary/m);
  assert.match(canonical, /## Portal/);
  assert.match(canonical, /## Source of truth/);
  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /reference\/GLOSSARY\.md/);
  assert.match(referenceIndex, /\[`GLOSSARY\.md`\]\(GLOSSARY\.md\)/);
  assert.match(docsIndex, /\[`reference\/GLOSSARY\.md`\]\(reference\/GLOSSARY\.md\)/);
  assert.match(inventory, /`docs\/reference\/GLOSSARY\.md`/);
  assert.doesNotMatch(inventory, /`docs\/GLOSSARY\.md` \| active runtime\/domain semantics/);
});

test('main documentation navigation points directly at relocated canonical owners', () => {
  const docsIndex = read('docs/README.md');
  const inventory = read('docs/DOCUMENTATION_INVENTORY.md');

  for (const path of [
    'operations/MAINTENANCE_MODE.md',
    'operations/OFFLINE_FULL_RESTORE.md',
    'operations/LOCAL_ACCEPTANCE_TESTS.md',
    'operations/P0_OPERATIONAL_ACCEPTANCE.md',
    'security/LOCAL_AUTH_RBAC.md',
  ]) {
    assert.ok(docsIndex.includes(path), `${path} must be linked from docs/README.md`);
    assert.ok(inventory.includes(`docs/${path}`), `docs/${path} must be canonical in the inventory`);
  }
});
