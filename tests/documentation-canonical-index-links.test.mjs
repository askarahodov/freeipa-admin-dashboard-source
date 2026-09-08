import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('central documentation index links directly to canonical moved owners', async () => {
  const index = await readFile(new URL('../docs/README.md', import.meta.url), 'utf8');
  const canonicalLinks = [
    '](operations/MAINTENANCE_MODE.md)',
    '](operations/OFFLINE_FULL_RESTORE.md)',
    '](security/LOCAL_AUTH_RBAC.md)',
    '](operations/LOCAL_ACCEPTANCE_TESTS.md)',
    '](operations/P0_OPERATIONAL_ACCEPTANCE.md)',
  ];
  for (const link of canonicalLinks) assert.ok(index.includes(link), `missing canonical link ${link}`);

  const compatibilityLinks = [
    '](MAINTENANCE_MODE.md)',
    '](OFFLINE_FULL_RESTORE.md)',
    '](LOCAL_AUTH_RBAC.md)',
    '](LOCAL_ACCEPTANCE_TESTS.md)',
    '](P0_OPERATIONAL_ACCEPTANCE.md)',
  ];
  for (const link of compatibilityLinks) assert.ok(!index.includes(link), `central index must not route through compatibility pointer ${link}`);
});
