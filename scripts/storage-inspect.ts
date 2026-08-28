#!/usr/bin/env node

import {
  parseStorageInspectCli,
  runStorageInspectCli,
  StorageInspectCliError,
} from "../src/storage/inspection/storage-inspect-cli.ts";

async function main(): Promise<void> {
  try {
    const options = parseStorageInspectCli(process.argv.slice(2), process.env);
    const result = await runStorageInspectCli(options);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    const code = error instanceof StorageInspectCliError
      ? error.code
      : "storage_inspect_argument_invalid";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 5;
  }
}

await main();
