import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const guardPath = new URL('../scripts/documentation-consistency.mjs', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);
const ciPath = new URL('../.github/workflows/ci.yml', import.meta.url);

const guardSource = fs.readFileSync(guardPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const ciSource = fs.readFileSync(ciPath, 'utf8');

test('documentation consistency guard passes against the current repository', () => {
  const result = spawnSync(process.execPath, [guardPath.pathname], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Documentation consistency guard passed/);
});

test('documentation consistency guard covers deterministic high-value drift classes', () => {
  assert.match(guardSource, /broken internal Markdown link/);
  assert.match(guardSource, /documented npm script does not exist/);
  assert.match(guardSource, /obsolete production-runtime claim/);
  assert.match(guardSource, /docs\/superpowers/);
});

test('documentation consistency guard is available locally and required by CI', () => {
  assert.equal(packageJson.scripts['docs:check'], 'node scripts/documentation-consistency.mjs');
  assert.match(ciSource, /docs-consistency:/);
  assert.match(ciSource, /npm run docs:check/);
  assert.match(ciSource, /needs: \[discover-tests, docs-consistency, dependency-security, build, container-security, recovery-compose, test\]/);
});
