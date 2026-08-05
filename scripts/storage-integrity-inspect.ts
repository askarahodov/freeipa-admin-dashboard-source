#!/usr/bin/env node

import {
  parseStorageIntegrityInspectCli,
  runStorageIntegrityInspectCli,
  StorageIntegrityInspectCliError,
} from "../storage-integrity-inspect-cli.ts";

async function main(): Promise<void> {
  try {
    const options = parseStorageIntegrityInspectCli(process.argv.slice(2), process.env);
    const result = await runStorageIntegrityInspectCli(options);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    const code = error instanceof StorageIntegrityInspectCliError
      ? error.code
      : "storage_integrity_inspect_unexpected_error";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 5;
  }
}

void main();
