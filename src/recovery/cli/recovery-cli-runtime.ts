import { RecoveryError } from "../foundation/recovery-errors.ts";
import { readSecretFile } from "../foundation/recovery-secrets.ts";
import type {
  RecoveryCliDependencies,
  RecoveryCliOptions,
  RecoveryCommandHandlers,
} from "./recovery-cli.ts";

const secretLimits: Readonly<Record<string, number>> = Object.freeze({
  "admin-password-file": 1_024,
  "backup-password-file": 1_024,
  "config-key-file": 512,
  "confirmation-file": 4_096,
  "controller-secret-file": 512,
  "recovery-password-file": 1_024,
  "service-token-file": 4_096,
});

function fail(code: string, message: string): never {
  throw new RecoveryError(code, 2, message);
}

async function readCliSecret(
  flag: string,
  path: string,
  options: RecoveryCliOptions,
): Promise<string> {
  const root = options["secrets-root"];
  const maxBytes = secretLimits[flag];
  if (typeof root !== "string" || !root.length || !Number.isSafeInteger(maxBytes)) {
    fail("recovery_secret_invalid", "Recovery secret is invalid");
  }
  return await readSecretFile({
    root,
    path,
    maxBytes,
    trimFinalNewline: true,
  });
}

async function withHeldRecoveryLock<T>(
  lockPath: string,
  callback: () => Promise<T>,
): Promise<T> {
  if (process.env.PORTAL_RECOVERY_LOCK_HELD !== "1"
      || process.env.PORTAL_RECOVERY_LOCK_PATH !== lockPath) {
    fail("recovery_lock_required", "Recovery lock is required");
  }
  return await callback();
}

export function createRecoveryCliRuntimeDependencies(
  handlers: RecoveryCommandHandlers,
): RecoveryCliDependencies {
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) {
    fail("recovery_cli_dependency_invalid", "Recovery CLI dependency is invalid");
  }
  return {
    readSecret: readCliSecret,
    withLock: withHeldRecoveryLock,
    handlers,
  };
}
