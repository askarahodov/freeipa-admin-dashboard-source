import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizePath(value) {
  return String(value).split(sep).join('/');
}

async function walk(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolutePath, output);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.test.mjs')) continue;
    output.push(normalizePath(relative(process.cwd(), absolutePath)));
  }
}

export async function discoverNodeTests(rootDirectory = 'tests') {
  const root = resolve(rootDirectory);
  const discovered = [];
  await walk(root, discovered);
  return discovered.sort();
}

export async function runDiscoverNodeTestsCli() {
  const tests = await discoverNodeTests(process.argv[2] ?? 'tests');
  if (!tests.length) throw new Error('No Node test files discovered');
  process.stdout.write(`${tests.join('\n')}\n`);
  return tests;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runDiscoverNodeTestsCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to discover Node tests'}\n`);
    process.exitCode = 1;
  }
}
