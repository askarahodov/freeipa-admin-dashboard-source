import { spawn } from "node:child_process";

console.warn(
  "[deprecated] `npm run start:docker` is a legacy development compatibility command. " +
    "It starts the Wrangler local Worker runtime and is not the production Docker entrypoint. " +
    "Use `npm start` / `npm run start:production` for the canonical Node production runtime, " +
    "or `npm run start:worker:dev` when you intentionally need the legacy local Worker runtime.",
);

const child = spawn(process.execPath, [new URL("./start-worker.mjs", import.meta.url).pathname], {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`Failed to start legacy development Worker runtime: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
