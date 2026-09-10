import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  discoverRecoveryTests,
  runRecoveryTestFiles,
} from '../../scripts/run-recovery-tests.mjs';

async function withFixtureTree(callback) {
  const root = await mkdtemp(join(tmpdir(), 'portal-recovery-tests-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('discovers recovery tests recursively without selecting sibling domains', async () => {
  await withFixtureTree(async (root) => {
    const recoveryRoot = join(root, 'tests', 'recovery');
    await mkdir(join(recoveryRoot, 'nested'), { recursive: true });
    await mkdir(join(root, 'tests', 'storage'), { recursive: true });
    await writeFile(join(recoveryRoot, 'top.test.mjs'), 'import test from "node:test"; test("top", () => {});\n');
    await writeFile(join(recoveryRoot, 'nested', 'deep.test.mjs'), 'import test from "node:test"; test("deep", () => {});\n');
    await writeFile(join(root, 'tests', 'storage', 'foreign.test.mjs'), 'import test from "node:test"; test("foreign", () => {});\n');

    const tests = await discoverRecoveryTests(recoveryRoot);

    assert.equal(tests.length, 2);
    assert.equal(tests.some((path) => path.endsWith('/top.test.mjs')), true);
    assert.equal(tests.some((path) => path.endsWith('/nested/deep.test.mjs')), true);
    assert.equal(tests.some((path) => path.includes('/storage/')), false);
  });
});

test('fails clearly when the recovery selection is empty', async () => {
  await withFixtureTree(async (root) => {
    const recoveryRoot = join(root, 'tests', 'recovery');
    await mkdir(recoveryRoot, { recursive: true });

    await assert.rejects(
      () => discoverRecoveryTests(recoveryRoot),
      /No recovery Node test files discovered/u,
    );
  });
});

test('propagates a selected test failure as a non-zero status', async () => {
  await withFixtureTree(async (root) => {
    const failing = join(root, 'failing.test.mjs');
    await writeFile(failing, 'import test from "node:test"; test("fails", () => { throw new Error("fixture failure"); });\n');

    const status = runRecoveryTestFiles([failing], { stdio: 'ignore' });

    assert.notEqual(status, 0);
  });
});

test('rejects an explicitly empty selected file list', () => {
  assert.throws(
    () => runRecoveryTestFiles([], { stdio: 'ignore' }),
    /No recovery Node test files selected/u,
  );
});
