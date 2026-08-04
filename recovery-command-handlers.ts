import { RecoveryError } from "./recovery-errors.ts";
import { loadRecoveryReceipt } from "./recovery-receipt.ts";
import type {
  RecoveryCliCommand,
  RecoveryCommandHandler,
  RecoveryCommandHandlers,
} from "./recovery-cli.ts";

export type RecoveryCommandHandlerOverrides = Partial<Record<RecoveryCliCommand, RecoveryCommandHandler>>;

function unavailable(command: RecoveryCliCommand): RecoveryCommandHandler {
  return async () => {
    throw new RecoveryError(
      "recovery_command_unavailable",
      2,
      `Recovery command ${command} is unavailable`,
    );
  };
}

const defaultStatus: RecoveryCommandHandler = async (input) => {
  const receipt = await loadRecoveryReceipt(input.options.receipt);
  return { receipt };
};

export function createRecoveryCommandHandlers(
  overrides: RecoveryCommandHandlerOverrides = {},
): RecoveryCommandHandlers {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new RecoveryError(
      "recovery_cli_dependency_invalid",
      2,
      "Recovery CLI dependency is invalid",
    );
  }
  return Object.freeze({
    preflight: overrides.preflight ?? unavailable("preflight"),
    "backup-current": overrides["backup-current"] ?? unavailable("backup-current"),
    restore: overrides.restore ?? unavailable("restore"),
    status: overrides.status ?? defaultStatus,
    verify: overrides.verify ?? unavailable("verify"),
    rollback: overrides.rollback ?? unavailable("rollback"),
    "maintenance-recover": overrides["maintenance-recover"] ?? unavailable("maintenance-recover"),
  });
}
