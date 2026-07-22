import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFreeIpaGateway } from "./freeipa-gateway.mjs";

const envFile = "/tmp/freeipa-dashboard-runtime.env";
const requestedGatewayPort = Number(process.env.IPA_GATEWAY_PORT || 0);
if (!Number.isInteger(requestedGatewayPort) || requestedGatewayPort < 0 || requestedGatewayPort > 65535) throw new Error("IPA_GATEWAY_PORT must be an integer between 0 and 65535");
const gatewayToken = randomBytes(32).toString("hex");
const gateway = createFreeIpaGateway({ token: gatewayToken });
await new Promise((resolvePromise, reject) => {
  gateway.once("error", reject);
  gateway.listen(requestedGatewayPort, "127.0.0.1", () => { gateway.off("error", reject); resolvePromise(); });
});
const gatewayAddress = gateway.address();
if (!gatewayAddress || typeof gatewayAddress === "string") throw new Error("FreeIPA Gateway did not acquire a TCP port");
const gatewayPort = gatewayAddress.port;

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
  .map((key) => `${key}=${JSON.stringify(process.env[key])}`)
  .concat([
    `IPA_NODE_GATEWAY_URL=${JSON.stringify(`http://127.0.0.1:${gatewayPort}`)}`,
    `IPA_NODE_GATEWAY_TOKEN=${JSON.stringify(gatewayToken)}`,
  ]);

writeFileSync(envFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
chmodSync(envFile, 0o600);

const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || "3001";
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
  gateway.close();
  child.kill(signal);
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

child.on("exit", (code, signal) => {
  try { unlinkSync(envFile); } catch {}
  gateway.close();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

child.on("error", (error) => {
  try { unlinkSync(envFile); } catch {}
  gateway.close();
  console.error(`Failed to start Worker runtime: ${error.message}`);
  process.exit(1);
});
