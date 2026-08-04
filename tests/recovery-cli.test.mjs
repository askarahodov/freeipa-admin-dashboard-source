import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRecoveryCli,
  runRecoveryCli,
} from "../recovery-cli.ts";

const basePreflight = [
  "preflight",
  "--data-root", "/data",
  "--artifact-root", "/artifacts",
  "--secrets-root", "/secrets",
  "--lock-path", "/data/.portal-exclusive.lock",
  "--backup", "/artifacts/backup.json",
  "--backup-password-file", "backup-password",
  "--controller-secret-file", "controller-secret",
  "--admin-username", "admin",
  "--admin-password-file", "admin-password",
  "--config-key-file", "config-key",
];

test("parses only the closed command flag schema", () => {
  const parsed = parseRecoveryCli(basePreflight);
  assert.equal(parsed.command, "preflight");
  assert.equal(parsed.options["data-root"], "/data");
  assert.equal(parsed.options["admin-username"], "admin");
  assert.equal(Object.isFrozen(parsed.options), true);

  const invalid = [
    [...basePreflight, "--unknown", "x"],
    [...basePreflight, "--data-root", "/other"],
    ["unknown-command"],
    ["preflight", "positional"],
    ["preflight", "--password", "secret"],
    ["preflight", "--data-root"],
  ];
  for (const argv of invalid) {
    assert.throws(
      () => parseRecoveryCli(argv),
      (error) => error.code === "recovery_cli_invalid",
    );
  }
});

test("loads secret files before invoking a read-only command", async () => {
  const operations = [];
  const result = await runRecoveryCli(basePreflight, {
    async readSecret(flag, path) {
      operations.push(`secret:${flag}:${path}`);
      return `${flag}-value`;
    },
    async withLock() { throw new Error("read-only command must not lock"); },
    handlers: {
      async preflight(input) {
        operations.push("handler:preflight");
        assert.equal(input.options["backup-password"], "backup-password-file-value");
        assert.equal(input.options["controller-secret"], "controller-secret-file-value");
        assert.equal(input.options["admin-password"], "admin-password-file-value");
        assert.equal(input.options["config-key"], "config-key-file-value");
        assert.equal(Object.hasOwn(input.options, "backup-password-file"), false);
        return { checks: { preflight: "ok" } };
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '{"checks":{"preflight":"ok"},"ok":true}\n');
  assert.deepEqual(operations, [
    "secret:admin-password-file:admin-password",
    "secret:backup-password-file:backup-password",
    "secret:config-key-file:config-key",
    "secret:controller-secret-file:controller-secret",
    "handler:preflight",
  ]);
});

test("wraps mutating offline commands in the recovery lock", async () => {
  const operations = [];
  const argv = [
    "restore",
    ...basePreflight.slice(1),
    "--receipt", "/artifacts/receipt.json",
    "--confirmation-file", "confirmation",
    "--candidate", "/data/candidate.sqlite",
    "--rollback", "/data/rollback.sqlite",
  ];
  const result = await runRecoveryCli(argv, {
    async readSecret(flag) {
      operations.push(`secret:${flag}`);
      return `${flag}-value`;
    },
    async withLock(path, callback) {
      operations.push(`lock:${path}`);
      return await callback();
    },
    handlers: {
      async restore(input) {
        operations.push("handler:restore");
        assert.equal(input.options.confirmation, "confirmation-file-value");
        return { phase: "swapped" };
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"ok":true,"phase":"swapped"}\n');
  assert.equal(operations.at(-2), "lock:/data/.portal-exclusive.lock");
  assert.equal(operations.at(-1), "handler:restore");
});

test("status neither loads secrets nor acquires a lock", async () => {
  const result = await runRecoveryCli([
    "status", "--receipt", "/artifacts/receipt.json",
  ], {
    async readSecret() { throw new Error("unexpected secret read"); },
    async withLock() { throw new Error("unexpected lock"); },
    handlers: {
      async status(input) {
        return { receipt: input.options.receipt, phase: "candidate_ready" };
      },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"ok":true,"phase":"candidate_ready","receipt":"/artifacts/receipt.json"}\n');
});

test("normalizes command failures without secret values", async () => {
  const result = await runRecoveryCli(basePreflight, {
    async readSecret() { return "secret-value"; },
    async withLock(_path, callback) { return await callback(); },
    handlers: {
      async preflight() {
        const error = new Error("raw secret-value upstream body");
        error.code = "recovery_backup_decryption_failed";
        error.exitCode = 6;
        throw error;
      },
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /secret-value/u);
  assert.equal(result.stderr, '{"error":{"code":"recovery_failed","message":"Recovery operation failed"},"ok":false}\n');
});
