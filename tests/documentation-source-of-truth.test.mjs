import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('source-of-truth registry has one canonical reference owner', () => {
  const canonical = read('docs/reference/SOURCE_OF_TRUTH.md');
  const pointer = read('docs/SOURCE_OF_TRUTH.md');
  const referenceIndex = read('docs/reference/README.md');
  const docsIndex = read('docs/README.md');

  assert.match(canonical, /^# Source of truth registry/m);
  assert.match(canonical, /Admin Dashboard Softrust/);
  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /reference\/SOURCE_OF_TRUTH\.md/);
  assert.match(referenceIndex, /\[`SOURCE_OF_TRUTH\.md`\]\(SOURCE_OF_TRUTH\.md\)/);
  assert.match(docsIndex, /\[`SOURCE_OF_TRUTH\.md`\]\(reference\/SOURCE_OF_TRUTH\.md\)/);
});

test('high-conflict policy tracks the canonical source-of-truth path', () => {
  const collisionPolicy = read('scripts/pr-collision-guard.mjs');

  assert.match(collisionPolicy, /docs\/reference\/SOURCE_OF_TRUTH\.md/);
  assert.doesNotMatch(collisionPolicy, /["']docs\/SOURCE_OF_TRUTH\.md["']/);
});
