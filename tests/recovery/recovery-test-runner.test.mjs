import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { discoverNodeTests } from './discover-node-tests.mjs';

export async function discoverRecoveryTests(rootDirectory = 'tests/recovery') {
  const tests = await discoverNodeTests(rootDirectory);
  if (!tests.length) {
    throw new Error(`No recovery Node test files discovered under ${rootDirectory}`);
  }
  return tests;
}

export function runRecoveryTestFiles(tests, options = {}) {
  if (!Array.isArray(tests) || tests.length === 0) {
    throw new Error('No recovery Node test files selected');
  }

  const env = { ...process.env, ...options.env };
  delete env.NODE_TEST_CONTEXT;

  const result = spawnSync(
    options.nodePath ?? process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    {
      cwd: options.cwd ?? process.cwd(),
      stdio: options.stdio ?? 'inherit',
      env,
    },
  );

  if (result.error) throw result.error;
  return result.status ?? 1;
}

export async function runRecoveryTests(options = {}) {
  const rootDirectory = options.rootDirectory ?? 'tests/recovery';
  const tests = await discoverRecoveryTests(rootDirectory);
  const status = runRecoveryTestFiles(tests, options);
  return { tests, status };
}

async function runCli() {
  const { tests, status } = await runRecoveryTests();
  process.stderr.write(`Recovery tests discovered: ${tests.length}\n`);
  process.exitCode = status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to run recovery tests'}\n`);
    process.exitCode = 1;
  }
}
