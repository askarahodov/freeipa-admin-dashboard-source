import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { discoverNodeTests } from '../../scripts/discover-node-tests.mjs';

function normalize(value) {
  return value.split(sep).join('/');
}

test('recursive Node-test discovery is deterministic and ignores non-test files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portal-node-tests-'));
  try {
    await mkdir(join(root, 'storage', 'nested'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'z.test.mjs'), '', 'utf8'),
      writeFile(join(root, 'storage', 'a.test.mjs'), '', 'utf8'),
      writeFile(join(root, 'storage', 'nested', 'b.test.mjs'), '', 'utf8'),
      writeFile(join(root, 'storage', 'nested', 'ignored.mjs'), '', 'utf8'),
    ]);

    const discovered = await discoverNodeTests(root);
    const expected = [
      join(root, 'storage', 'a.test.mjs'),
      join(root, 'storage', 'nested', 'b.test.mjs'),
      join(root, 'z.test.mjs'),
    ].map((path) => normalize(relative(process.cwd(), path))).sort();

    assert.deepEqual(discovered, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recursive discovery still contains every current flat test', async () => {
  const discovered = new Set(await discoverNodeTests('tests'));
  const flatTests = (await readdir('tests', { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => `tests/${entry.name}`);

  assert.ok(flatTests.length > 0, 'expected an existing flat test baseline');
  for (const path of flatTests) assert.ok(discovered.has(path), `missing flat baseline test: ${path}`);
});
