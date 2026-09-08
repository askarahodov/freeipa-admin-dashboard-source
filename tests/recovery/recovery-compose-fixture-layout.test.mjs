import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('recovery compose smoke uses the canonical deployment fixture', () => {
  assert.equal(existsSync('compose.recovery.test.yaml'), false, 'legacy root recovery compose fixture must stay absent');
  assert.equal(existsSync('deploy/compose/recovery.test.yaml'), true, 'canonical recovery compose fixture must exist');

  const fixture = read('deploy/compose/recovery.test.yaml');
  const smoke = read('scripts/recovery-compose-smoke.mjs');
  const owner = read('deploy/README.md');

  assert.match(fixture, /context:\s+\.\.\/\.\./);
  assert.match(smoke, /"-f", "deploy\/compose\/recovery\.test\.yaml"/);
  assert.match(owner, /compose\/recovery\.test\.yaml/);
  assert.match(owner, /scripts\/recovery-compose-smoke\.mjs/);
});
