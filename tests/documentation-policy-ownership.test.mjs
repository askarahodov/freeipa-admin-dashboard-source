import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('documentation policy has one canonical development owner', () => {
  const canonical = read('docs/development/DOCUMENTATION_POLICY.md');
  const pointer = read('docs/DOCUMENTATION_POLICY.md');
  const developmentIndex = read('docs/development/README.md');
  const docsIndex = read('docs/README.md');

  assert.match(canonical, /^# Documentation policy/m);
  assert.match(canonical, /Docs as code/);
  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /development\/DOCUMENTATION_POLICY\.md/);
  assert.match(developmentIndex, /\[`DOCUMENTATION_POLICY\.md`\]\(DOCUMENTATION_POLICY\.md\)/);
  assert.match(docsIndex, /\[`DOCUMENTATION_POLICY\.md`\]\(development\/DOCUMENTATION_POLICY\.md\)/);
});

test('AI guidance points directly at the canonical documentation policy', () => {
  const aiGuide = read('docs/ai/README.md');

  assert.match(aiGuide, /\.\.\/development\/DOCUMENTATION_POLICY\.md/);
  assert.doesNotMatch(aiGuide, /\]\(\.\.\/DOCUMENTATION_POLICY\.md\)/);
});
