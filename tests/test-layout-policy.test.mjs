import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const expectedCategories = ['auth', 'rbac', 'freeipa', 'xyops', 'settings', 'ui'];

test('test layout design preserves current discovery and E2E routing invariants', async () => {
  const [policy, ci, pkg, scope] = await Promise.all([
    readFile(new URL('../docs/development/TEST_LAYOUT.md', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/auth-e2e-scope.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(ci, /find tests -maxdepth 1 -name '\*\.test\.mjs'/u);
  assert.match(JSON.parse(pkg).scripts.test, /tests\/\*\.test\.mjs/u);
  assert.match(policy, /moving a Node test into a subdirectory before changing both local and CI discovery would silently remove it/u);
  assert.match(policy, /discovery-only/u);

  for (const category of expectedCategories) {
    assert.ok(policy.includes(`\`${category}\``), `policy must preserve E2E category ${category}`);
    assert.match(scope, new RegExp(`\\b${category}: \\[`, 'u'), `router must define category ${category}`);
  }
});
