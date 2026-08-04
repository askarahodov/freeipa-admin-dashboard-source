import { fileURLToPath } from "node:url";

import { createRecoveryCliRuntimeDependencies } from "../recovery-cli-runtime.ts";
import {
  isMutatingRecoveryCommand,
  parseRecoveryCli,
  runRecoveryCli,
} from "../recovery-cli.ts";
import {
  canonicalRecoveryResult,
  safeRecoveryFailure,
} from "../recovery-errors.ts";
import { runWithRecoveryLock } from "../recovery-lock.ts";
import { createRecoveryRuntimeCommandHandlers } from "../recovery-runtime-command-handlers.ts";

function writeLine(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(canonicalRecoveryResult(value))}\n`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseRecoveryCli(argv);
  } catch {
    const result = await runRecoveryCli(
      argv,
      createRecoveryCliRuntimeDependencies(createRecoveryRuntimeCommandHandlers()),
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  }

  if (isMutatingRecoveryCommand(parsed.command)
      && process.env.PORTAL_RECOVERY_LOCK_HELD !== "1") {
    try {
      const entrypoint = fileURLToPath(import.meta.url);
      const nodeArgs = process.execArgv.includes("--experimental-strip-types")
        ? [...process.execArgv]
        : ["--experimental-strip-types", ...process.execArgv];
      return await runWithRecoveryLock({
        lockPath: parsed.options["lock-path"],
        mode: "recovery",
        command: process.execPath,
        args: [...nodeArgs, entrypoint, ...argv],
        env: {
          ...process.env,
          PORTAL_RECOVERY_LOCK_HELD: "1",
          PORTAL_RECOVERY_LOCK_PATH: parsed.options["lock-path"],
        },
        stdio: "inherit",
      });
    } catch (error) {
      writeLine(process.stderr, safeRecoveryFailure(error));
      return typeof error === "object"
        && error !== null
        && Number.isSafeInteger((error as { exitCode?: unknown }).exitCode)
        ? Number((error as { exitCode: number }).exitCode)
        : 1;
    }
  }

  const result = await runRecoveryCli(
    argv,
    createRecoveryCliRuntimeDependencies(createRecoveryRuntimeCommandHandlers()),
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  process.exitCode = await main();
}

export { main as runPortalRecoveryCli };
