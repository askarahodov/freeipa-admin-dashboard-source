import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('central documentation index names and links canonical moved owners directly', async () => {
  const index = await readFile(new URL('../docs/README.md', import.meta.url), 'utf8');
  const canonicalEntries = [
    '[`operations/MAINTENANCE_MODE.md`](operations/MAINTENANCE_MODE.md)',
    '[`operations/OFFLINE_FULL_RESTORE.md`](operations/OFFLINE_FULL_RESTORE.md)',
    '[`security/LOCAL_AUTH_RBAC.md`](security/LOCAL_AUTH_RBAC.md)',
    '[`operations/LOCAL_ACCEPTANCE_TESTS.md`](operations/LOCAL_ACCEPTANCE_TESTS.md)',
    '[`operations/P0_OPERATIONAL_ACCEPTANCE.md`](operations/P0_OPERATIONAL_ACCEPTANCE.md)',
    '[`reference/GLOSSARY.md`](reference/GLOSSARY.md)',
  ];
  for (const entry of canonicalEntries) assert.ok(index.includes(entry), `missing canonical index entry ${entry}`);

  const staleEntries = [
    '[`MAINTENANCE_MODE.md`](operations/MAINTENANCE_MODE.md)',
    '[`OFFLINE_FULL_RESTORE.md`](operations/OFFLINE_FULL_RESTORE.md)',
    '[`LOCAL_AUTH_RBAC.md`](security/LOCAL_AUTH_RBAC.md)',
    '[`LOCAL_ACCEPTANCE_TESTS.md`](operations/LOCAL_ACCEPTANCE_TESTS.md)',
    '[`P0_OPERATIONAL_ACCEPTANCE.md`](operations/P0_OPERATIONAL_ACCEPTANCE.md)',
    '[`GLOSSARY.md`](GLOSSARY.md)',
  ];
  for (const entry of staleEntries) assert.ok(!index.includes(entry), `central index must not present compatibility-path entry ${entry}`);
});
