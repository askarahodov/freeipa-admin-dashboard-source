import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";

import {
  probeRecoveryLock,
  runWithRecoveryLock,
} from "../src/recovery/foundation/recovery-lock.ts";

async function waitForLine(stream, expected, timeoutMs = 5_000) {
  let value = "";
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for child output")), timeoutMs);
    const onData = (chunk) => {
      value += String(chunk);
      if (value.split(/\r?\n/u).includes(expected)) {
        clearTimeout(timer);
        stream.off("data", onData);
        resolve();
      }
    };
    stream.on("data", onData);
  });
}

function spawnHolder(lockPath) {
  return spawn("/usr/bin/flock", [
    "--exclusive",
    "--nonblock",
    "--conflict-exit-code", "75",
    "--no-fork",
    lockPath,
    process.execPath,
    "-e",
    "console.log('locked'); setInterval(() => {}, 1000);",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopHolder(holder) {
  if (holder.exitCode !== null || holder.signalCode !== null) return;
  const exited = once(holder, "exit");
  holder.kill("SIGKILL");
  await exited;
}

test("runtime and recovery cannot hold the same kernel lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-lock-"));
  const lockPath = join(root, "exclusive.lock");
  const holder = spawnHolder(lockPath);
  t.after(async () => {
    await stopHolder(holder);
    await rm(root, { recursive: true, force: true });
  });
  await waitForLine(holder.stdout, "locked");

  assert.deepEqual(await probeRecoveryLock(lockPath), { available: false });
  await assert.rejects(
    runWithRecoveryLock({
      lockPath,
      mode: "recovery",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      stdio: "pipe",
    }),
    (error) => error && error.code === "recovery_lock_busy" && error.exitCode === 75,
  );
});

test("the operating system releases the lock after holder termination", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-lock-release-"));
  const lockPath = join(root, "exclusive.lock");
  const holder = spawnHolder(lockPath);
  t.after(() => rm(root, { recursive: true, force: true }));
  await waitForLine(holder.stdout, "locked");

  await stopHolder(holder);
  assert.deepEqual(await probeRecoveryLock(lockPath), { available: true });
});

test("lock runner preserves the child exit code without invoking a shell", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-lock-exit-"));
  const lockPath = join(root, "exclusive.lock");
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(await runWithRecoveryLock({
    lockPath,
    mode: "runtime",
    command: process.execPath,
    args: ["-e", "process.exit(23)"],
    stdio: "pipe",
  }), 23);
});

test("lock adapter rejects malformed paths, modes and commands", async () => {
  const cases = [
    { lockPath: "relative.lock", mode: "runtime", command: process.execPath, args: [] },
    { lockPath: "/tmp/valid.lock", mode: "other", command: process.execPath, args: [] },
    { lockPath: "/tmp/valid.lock", mode: "runtime", command: "relative-command", args: [] },
    { lockPath: "/tmp/valid.lock", mode: "runtime", command: process.execPath, args: ["a\0b"] },
  ];
  for (const value of cases) {
    await assert.rejects(
      runWithRecoveryLock({ ...value, stdio: "pipe" }),
      (error) => error && error.code === "recovery_lock_invalid",
    );
  }
});
