import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const expectedCategories = ['auth', 'rbac', 'freeipa', 'xyops', 'settings', 'ui'];

test('test layout policy keeps local and CI discovery on the shared recursive owner', async () => {
  const [policy, ci, pkg, scope] = await Promise.all([
    readFile(new URL('../docs/development/TEST_LAYOUT.md', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/auth-e2e-scope.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(ci, /node scripts\/discover-node-tests\.mjs/u);
  assert.doesNotMatch(ci, /find tests -maxdepth 1/u);
  assert.match(JSON.parse(pkg).scripts.test, /node scripts\/run-node-tests\.mjs/u);
  assert.doesNotMatch(JSON.parse(pkg).scripts.test, /tests\/\*\.test\.mjs/u);
  assert.match(policy, /discovered recursively and deterministically/u);
  assert.match(policy, /same recursive list/u);

  for (const category of expectedCategories) {
    assert.ok(policy.includes(`\`${category}\``), `policy must preserve E2E category ${category}`);
    assert.match(scope, new RegExp(`\\b${category}: \\[`, 'u'), `router must define category ${category}`);
  }
});
