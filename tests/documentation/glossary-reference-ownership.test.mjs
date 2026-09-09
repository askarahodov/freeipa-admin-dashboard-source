import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('project glossary has one canonical reference owner', () => {
  const canonical = read('docs/reference/GLOSSARY.md');
  const pointer = read('docs/GLOSSARY.md');
  const referenceIndex = read('docs/reference/README.md');

  assert.match(canonical, /^# Project glossary/m);
  assert.match(canonical, /## Portal/);
  assert.match(canonical, /## Source of truth/);
  assert.match(pointer, /^# Relocated/m);
  assert.match(pointer, /reference\/GLOSSARY\.md/);
  assert.match(referenceIndex, /\[`GLOSSARY\.md`\]\(GLOSSARY\.md\)/);
});
