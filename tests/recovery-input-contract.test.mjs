import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  resolveContainedRegularFile,
  resolveRecoveryRoots,
} from "../src/recovery/foundation/recovery-paths.ts";
import { readSecretFile } from "../src/recovery/foundation/recovery-secrets.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-input-"));
  const dataRoot = join(root, "data");
  const artifactRoot = join(root, "artifacts");
  const secretsRoot = join(root, "secrets");
  await Promise.all([
    mkdir(dataRoot, { mode: 0o700 }),
    mkdir(artifactRoot, { mode: 0o700 }),
    mkdir(secretsRoot, { mode: 0o700 }),
  ]);
  return { root, dataRoot, artifactRoot, secretsRoot };
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error && error.code === code && !String(error.message).includes("secret-value"),
  );
}

test("resolves separate canonical recovery roots", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  assert.deepEqual(resolveRecoveryRoots({
    dataRoot: value.dataRoot,
    artifactRoot: value.artifactRoot,
    secretsRoot: value.secretsRoot,
  }), {
    dataRoot: value.dataRoot,
    artifactRoot: value.artifactRoot,
    secretsRoot: value.secretsRoot,
  });
});

test("rejects artifact roots equal to or nested inside live data", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const nested = join(value.dataRoot, "recovery");
  await mkdir(nested);

  assert.throws(
    () => resolveRecoveryRoots({ dataRoot: value.dataRoot, artifactRoot: value.dataRoot, secretsRoot: value.secretsRoot }),
    (error) => error.code === "recovery_roots_invalid",
  );
  assert.throws(
    () => resolveRecoveryRoots({ dataRoot: value.dataRoot, artifactRoot: nested, secretsRoot: value.secretsRoot }),
    (error) => error.code === "recovery_roots_invalid",
  );
});

test("rejects symlink roots and path traversal", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const linked = join(value.root, "linked-data");
  await symlink(value.dataRoot, linked, "dir");

  assert.throws(
    () => resolveRecoveryRoots({ dataRoot: linked, artifactRoot: value.artifactRoot, secretsRoot: value.secretsRoot }),
    (error) => error.code === "recovery_roots_invalid",
  );
  await expectCode(
    resolveContainedRegularFile(value.artifactRoot, "../data/database.sqlite", "backup"),
    "recovery_path_invalid",
  );
});

test("contained regular-file resolver rejects directories and symlinks", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const file = join(value.artifactRoot, "backup.json");
  const linked = join(value.artifactRoot, "linked.json");
  await writeFile(file, "{}", { mode: 0o600 });
  await symlink(file, linked);

  assert.equal(
    await resolveContainedRegularFile(value.artifactRoot, "backup.json", "backup"),
    file,
  );
  await expectCode(
    resolveContainedRegularFile(value.artifactRoot, ".", "backup"),
    "recovery_path_invalid",
  );
  await expectCode(
    resolveContainedRegularFile(value.artifactRoot, "linked.json", "backup"),
    "recovery_path_invalid",
  );
});

test("reads a mode-0600 secret and removes exactly one final newline", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const path = join(value.secretsRoot, "backup-password");
  await writeFile(path, "secret-value\n", { mode: 0o600 });

  assert.equal(await readSecretFile({
    root: value.secretsRoot,
    path: "backup-password",
    maxBytes: 1024,
    trimFinalNewline: true,
  }), "secret-value");

  assert.equal(await readSecretFile({
    root: value.secretsRoot,
    path: "backup-password",
    maxBytes: 1024,
    trimFinalNewline: false,
  }), "secret-value\n");
});

test("rejects group-readable and symlink secret files", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const path = join(value.secretsRoot, "secret");
  const linked = join(value.secretsRoot, "linked-secret");
  await writeFile(path, "secret-value", { mode: 0o600 });
  await chmod(path, 0o640);
  await symlink(path, linked);

  await expectCode(readSecretFile({ root: value.secretsRoot, path: "secret", maxBytes: 1024, trimFinalNewline: true }), "recovery_secret_permissions_invalid");
  await expectCode(readSecretFile({ root: value.secretsRoot, path: "linked-secret", maxBytes: 1024, trimFinalNewline: true }), "recovery_secret_invalid");
});

test("rejects empty, NUL-containing, oversized and multiply-newline secrets", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));

  const cases = [
    ["empty", "", 1024],
    ["nul", "a\0b", 1024],
    ["oversized", "abcdef", 4],
    ["newlines", "secret-value\n\n", 1024],
  ];
  for (const [name, contents, maxBytes] of cases) {
    await writeFile(join(value.secretsRoot, name), contents, { mode: 0o600 });
    await expectCode(
      readSecretFile({ root: value.secretsRoot, path: name, maxBytes, trimFinalNewline: true }),
      "recovery_secret_invalid",
    );
  }
});
