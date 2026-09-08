import { spawnSync } from 'node:child_process';
import { discoverNodeTests } from './discover-node-tests.mjs';

const tests = await discoverNodeTests();
if (!tests.length) throw new Error('No Node test files discovered');

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', ...tests],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
