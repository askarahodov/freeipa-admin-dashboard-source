import { spawn } from "node:child_process";
import { chmodSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envFile = "/tmp/freeipa-dashboard-runtime.env";
const forwardedKeys = [
  "ADMIN_TOKEN",
  "CONFIG_ENCRYPTION_KEY",
  "DEMO_MODE",
  "IPA_URL",
  "IPA_USERNAME",
  "IPA_PASSWORD",
  "IPA_VERIFY_TLS",
  "XYOPS_URL",
  "XYOPS_API_KEY",
  "XYOPS_EVENT_ID",
  "XYOPS_ROUTES_JSON",
];

const lines = forwardedKeys
  .filter((key) => process.env[key] !== undefined)
  .map((key) => `${key}=${JSON.stringify(process.env[key])}`);

writeFileSync(envFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
chmodSync(envFile, 0o600);

const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || "3000";
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
const child = spawn(process.execPath, [
  wrangler,
  "dev",
  "--config", "dist/server/wrangler.json",
  "--ip", host,
  "--port", port,
  "--persist-to", ".wrangler",
  "--local",
  "--env-file", envFile,
  "--show-interactive-dev-session=false",
  "--log-level", "warn",
], {
  stdio: "inherit",
  env: {
    ...process.env,
    HOME: "/tmp/freeipa-dashboard-home",
    XDG_CONFIG_HOME: "/tmp/freeipa-dashboard-xdg",
    WRANGLER_LOG_PATH: "/tmp/freeipa-dashboard-wrangler.log",
    WRANGLER_SEND_METRICS: "false",
  },
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

child.on("exit", (code, signal) => {
  try { unlinkSync(envFile); } catch {}
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

child.on("error", (error) => {
  try { unlinkSync(envFile); } catch {}
  console.error(`Failed to start Worker runtime: ${error.message}`);
  process.exit(1);
});
