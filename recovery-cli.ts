import {
  RecoveryError,
  canonicalRecoveryResult,
  safeRecoveryFailure,
} from "./recovery-errors.ts";

export const RECOVERY_CLI_COMMANDS = Object.freeze([
  "preflight",
  "backup-current",
  "restore",
  "status",
  "verify",
  "rollback",
  "maintenance-recover",
] as const);

export type RecoveryCliCommand = typeof RECOVERY_CLI_COMMANDS[number];
export type RecoveryCliOptions = Readonly<Record<string, string>>;
export type ParsedRecoveryCli = Readonly<{
  command: RecoveryCliCommand;
  options: RecoveryCliOptions;
}>;

export type RecoveryCommandInput = Readonly<{
  command: RecoveryCliCommand;
  options: RecoveryCliOptions;
}>;

export type RecoveryCommandHandler = (input: RecoveryCommandInput) => Promise<unknown>;
export type RecoveryCommandHandlers = Partial<Record<RecoveryCliCommand, RecoveryCommandHandler>>;

export type RecoveryCliDependencies = {
  readSecret(flag: string, path: string): Promise<string>;
  withLock<T>(lockPath: string, callback: () => Promise<T>): Promise<T>;
  handlers: RecoveryCommandHandlers;
};

export type RecoveryCliResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

const preflightFlags = Object.freeze([
  "data-root",
  "artifact-root",
  "secrets-root",
  "lock-path",
  "backup",
  "backup-password-file",
  "controller-secret-file",
  "admin-username",
  "admin-password-file",
  "config-key-file",
] as const);

const commandFlags: Readonly<Record<RecoveryCliCommand, readonly string[]>> = Object.freeze({
  preflight: preflightFlags,
  "backup-current": Object.freeze([
    ...preflightFlags,
    "recovery-password-file",
    "recovery-point",
    "receipt",
  ]),
  restore: Object.freeze([
    ...preflightFlags,
    "receipt",
    "confirmation-file",
    "candidate",
    "rollback",
  ]),
  status: Object.freeze(["receipt"]),
  verify: Object.freeze([
    "receipt",
    "controller-secret-file",
    "admin-username",
    "admin-password-file",
    "service-token-file",
    "base-url",
  ]),
  rollback: Object.freeze([
    "receipt",
    "data-root",
    "artifact-root",
    "secrets-root",
    "lock-path",
    "recovery-point",
    "recovery-password-file",
    "live",
    "rollback",
    "failed",
    "recovery-temp",
  ]),
  "maintenance-recover": Object.freeze([
    "receipt",
    "data-root",
    "artifact-root",
    "secrets-root",
    "lock-path",
    "admin-username",
    "admin-password-file",
    "config-key-file",
    "confirmation-file",
  ]),
});

const secretFileTargets = Object.freeze({
  "admin-password-file": "admin-password",
  "backup-password-file": "backup-password",
  "config-key-file": "config-key",
  "confirmation-file": "confirmation",
  "controller-secret-file": "controller-secret",
  "recovery-password-file": "recovery-password",
  "service-token-file": "service-token",
} as const);

const mutatingOfflineCommands = new Set<RecoveryCliCommand>([
  "backup-current",
  "restore",
  "rollback",
  "maintenance-recover",
]);

const commandSet = new Set<string>(RECOVERY_CLI_COMMANDS);
const flagPattern = /^--[a-z][a-z0-9-]{0,63}$/u;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_BYTES = 65_536;

function fail(code = "recovery_cli_invalid", message = "Recovery CLI request is invalid"): never {
  throw new RecoveryError(code, 2, message);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validArgument(value: unknown): value is string {
  return typeof value === "string"
    && !value.includes("\0")
    && byteLength(value) <= MAX_ARGUMENT_BYTES;
}

export function parseRecoveryCli(argv: readonly string[]): ParsedRecoveryCli {
  if (!Array.isArray(argv)
      || argv.length < 1
      || argv.length > MAX_ARGUMENTS
      || argv.some((value) => !validArgument(value))) {
    fail();
  }
  const commandValue = argv[0];
  if (!commandSet.has(commandValue)) fail();
  const command = commandValue as RecoveryCliCommand;
  const allowed = new Set(commandFlags[command]);
  const options: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 2) {
    const rawFlag = argv[index];
    const value = argv[index + 1];
    if (!flagPattern.test(rawFlag)
        || value === undefined
        || value.startsWith("--")
        || !validArgument(value)) {
      fail();
    }
    const flag = rawFlag.slice(2);
    if (!allowed.has(flag) || Object.hasOwn(options, flag)) fail();
    options[flag] = value;
  }
  if (Object.keys(options).length !== allowed.size
      || [...allowed].some((flag) => !Object.hasOwn(options, flag))) {
    fail();
  }
  return Object.freeze({ command, options: Object.freeze({ ...options }) });
}

function canonicalJsonLine(value: unknown): string {
  return `${JSON.stringify(canonicalRecoveryResult(value))}\n`;
}

async function hydrateSecretFiles(
  parsed: ParsedRecoveryCli,
  dependencies: RecoveryCliDependencies,
): Promise<RecoveryCommandInput> {
  const options: Record<string, string> = { ...parsed.options };
  const secretFlags = Object.keys(secretFileTargets)
    .filter((flag) => Object.hasOwn(options, flag))
    .sort();
  for (const flag of secretFlags) {
    const target = secretFileTargets[flag as keyof typeof secretFileTargets];
    const path = options[flag];
    const value = await dependencies.readSecret(flag, path);
    if (typeof value !== "string" || !value.length || value.includes("\0")) {
      fail("recovery_secret_invalid", "Recovery secret is invalid");
    }
    delete options[flag];
    options[target] = value;
  }
  return Object.freeze({
    command: parsed.command,
    options: Object.freeze(options),
  });
}

function validateDependencies(value: RecoveryCliDependencies): RecoveryCliDependencies {
  if (!value
      || typeof value !== "object"
      || Array.isArray(value)
      || typeof value.readSecret !== "function"
      || typeof value.withLock !== "function"
      || !value.handlers
      || typeof value.handlers !== "object"
      || Array.isArray(value.handlers)) {
    fail("recovery_cli_dependency_invalid", "Recovery CLI dependency is invalid");
  }
  return value;
}

export async function runRecoveryCli(
  argv: readonly string[],
  dependenciesValue: RecoveryCliDependencies,
): Promise<RecoveryCliResult> {
  try {
    const dependencies = validateDependencies(dependenciesValue);
    const parsed = parseRecoveryCli(argv);
    const input = await hydrateSecretFiles(parsed, dependencies);
    const handler = dependencies.handlers[parsed.command];
    if (typeof handler !== "function") {
      fail("recovery_command_unavailable", "Recovery command is unavailable");
    }
    const execute = async () => await handler(input);
    const result = mutatingOfflineCommands.has(parsed.command)
      ? await dependencies.withLock(input.options["lock-path"], execute)
      : await execute();
    const safeResult = canonicalRecoveryResult({ ok: true, ...(result && typeof result === "object" ? result : { result }) });
    return Object.freeze({ exitCode: 0, stdout: canonicalJsonLine(safeResult), stderr: "" });
  } catch (error) {
    const failure = safeRecoveryFailure(error);
    return Object.freeze({
      exitCode: error instanceof RecoveryError ? error.exitCode : 1,
      stdout: "",
      stderr: canonicalJsonLine(failure),
    });
  }
}
