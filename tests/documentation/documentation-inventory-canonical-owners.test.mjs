import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('documentation inventory names canonical owners for relocated active docs', async () => {
  const inventory = await readFile(new URL('../../docs/DOCUMENTATION_INVENTORY.md', import.meta.url), 'utf8');
  const canonical = [
    '`docs/reference/GLOSSARY.md`',
    '`docs/security/LOCAL_AUTH_RBAC.md`',
    '`docs/operations/MAINTENANCE_MODE.md`',
    '`docs/operations/OFFLINE_FULL_RESTORE.md`',
    '`docs/operations/LOCAL_ACCEPTANCE_TESTS.md`',
    '`docs/operations/P0_OPERATIONAL_ACCEPTANCE.md`',
  ];
  for (const path of canonical) assert.ok(inventory.includes(path), `missing canonical inventory owner ${path}`);

  const stale = [
    '`docs/GLOSSARY.md`',
    '`docs/LOCAL_AUTH_RBAC.md`',
    '`docs/MAINTENANCE_MODE.md`',
    '`docs/OFFLINE_FULL_RESTORE.md`',
    '`docs/LOCAL_ACCEPTANCE_TESTS.md`',
    '`docs/P0_OPERATIONAL_ACCEPTANCE.md`',
  ];
  for (const path of stale) assert.ok(!inventory.includes(path), `inventory must not name compatibility pointer as active owner ${path}`);
});
