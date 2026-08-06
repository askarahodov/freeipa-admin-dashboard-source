import {
  parseStorageMigrationPreflightInspectCli,
  runStorageMigrationPreflightInspectCli,
  StorageMigrationPreflightInspectCliError,
} from "../storage-migration-preflight-inspect-cli.ts";

async function main(): Promise<void> {
  try {
    const options = parseStorageMigrationPreflightInspectCli(process.argv.slice(2), process.env);
    const result = await runStorageMigrationPreflightInspectCli(options);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    const code = error instanceof StorageMigrationPreflightInspectCliError
      ? error.code
      : "storage_migration_preflight_inspect_internal_error";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 5;
  }
}

void main();
