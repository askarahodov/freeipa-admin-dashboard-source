import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

const CONFLICT_EXIT_CODE = 75;
const values = process.argv.slice(2);
const lockPath = values.shift();
const command = values.shift();

function valid(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\0")
    && isAbsolute(value);
}

if (!valid(lockPath) || !valid(command) || values.some((value) => typeof value !== "string" || value.includes("\0"))) {
  console.error("Runtime recovery lock request is invalid");
  process.exit(2);
}

const child = spawn("/usr/bin/flock", [
  "--exclusive",
  "--nonblock",
  "--conflict-exit-code", String(CONFLICT_EXIT_CODE),
  "--no-fork",
  lockPath,
  command,
  ...values,
], {
  stdio: "inherit",
  env: process.env,
  shell: false,
});

let stopping = false;
function forward(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));

child.once("error", () => {
  console.error("Failed to start portal runtime under recovery lock");
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (code === CONFLICT_EXIT_CODE) {
    console.error("Portal recovery lock is busy");
    process.exit(CONFLICT_EXIT_CODE);
  }
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
