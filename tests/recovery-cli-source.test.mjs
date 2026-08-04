import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const core = await readFile(new URL("../recovery-cli.ts", import.meta.url), "utf8");
const entry = await readFile(new URL("../scripts/portal-recovery.ts", import.meta.url), "utf8");

test("recovery cli has no secret-value flags or bypass options", () => {
  for (const source of [core, entry]) {
    assert.doesNotMatch(source, /--(?:password|controller-secret|admin-password|config-key)(?:\s|["'])/u);
    assert.doesNotMatch(source, /--(?:force-running|ignore-lock|skip-recovery-point|ignore-checksum|ignore-schema)/u);
    assert.doesNotMatch(source, /prompt\s*\(/u);
  }
});

test("process entrypoint owns no SQL crypto or path traversal logic", () => {
  assert.doesNotMatch(entry, /\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE TABLE|DROP TABLE)\b/iu);
  assert.doesNotMatch(entry, /createCipheriv|createDecipheriv|PBKDF2|AES-256-GCM/u);
  assert.doesNotMatch(entry, /realpath|relative\(|lstat|readSecretFile/u);
  assert.match(entry, /runRecoveryCli/u);
  assert.match(entry, /createRecoveryRuntimeCommandHandlers/u);
});

test("command schema explicitly lists every public command", () => {
  for (const command of [
    "preflight",
    "backup-current",
    "restore",
    "status",
    "verify",
    "rollback",
    "maintenance-recover",
  ]) {
    assert.match(core, new RegExp(`(?:"${command}"|${command.replaceAll("-", "_")})`, "u"));
  }
});
