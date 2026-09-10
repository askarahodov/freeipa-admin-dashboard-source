import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../.dockerignore", import.meta.url), "utf8");
const patterns = source
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

function declared(pattern) {
  assert.ok(patterns.includes(pattern), `expected .dockerignore to declare ${pattern}`);
}

test("Docker build context excludes synthetic local secret, state, cache and output roots", () => {
  for (const pattern of [
    ".env*",
    ".dev.vars",
    ".sites-runtime",
    ".wrangler",
    "node_modules",
    "coverage",
    "artifacts",
    "outputs",
    "work",
    "recovery/",
    "recovery-secrets/",
    "*.pem",
  ]) declared(pattern);
});

test("tracked environment examples remain explicit Docker context exceptions", () => {
  for (const pattern of [
    "!.env.example",
    "!.env.test.example",
    "!.env.local-auth-acceptance.example",
    "!.env.e2e.example",
  ]) declared(pattern);
});

test("Compose default recovery host roots are explicitly excluded from Docker build context", async () => {
  const compose = await readFile(new URL("../../compose.yaml", import.meta.url), "utf8");
  assert.match(compose, /PORTAL_RECOVERY_DIR:-\.\/recovery/u);
  assert.match(compose, /PORTAL_RECOVERY_SECRETS_DIR:-\.\/recovery-secrets/u);
  declared("recovery/");
  declared("recovery-secrets/");
});
