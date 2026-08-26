import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PORTAL_CONFIGURATION_CONTRACT, getPortalConfiguration } from "../worker/portal-configuration-contract.ts";

const repositoryRoot = new URL("../", import.meta.url);

function parseAssignedEnvironmentNames(source) {
  return [...source.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]);
}

test("configuration contract has unique names and no secret values", () => {
  const names = PORTAL_CONFIGURATION_CONTRACT.map((record) => record.name);
  assert.equal(new Set(names).size, names.length);

  for (const record of PORTAL_CONFIGURATION_CONTRACT) {
    assert.match(record.name, /^[A-Z][A-Z0-9_]+$/);
    assert.ok(record.validationOwner);
    assert.ok(record.transportOwner);
    assert.ok(record.precedence);
    assert.ok(record.class);
    assert.ok(record.compatibility);
    assert.equal(typeof record.secret, "boolean");
    assert.equal(typeof record.required, "boolean");
    assert.equal(record.secret ? record.exposure : record.exposure, record.exposure);
    assert.doesNotMatch(JSON.stringify(record), /change-me|replace-with|secret-value|password-value/i);
  }
});

test("internal ephemeral gateway credentials never become operator configuration", () => {
  assert.equal(getPortalConfiguration("IPA_NODE_GATEWAY_URL"), undefined);
  assert.equal(getPortalConfiguration("IPA_NODE_GATEWAY_TOKEN"), undefined);
});

test("supported .env.example variables have a canonical metadata record", async () => {
  const envExample = await readFile(new URL(".env.example", repositoryRoot), "utf8");
  const registryNames = new Set(PORTAL_CONFIGURATION_CONTRACT.map((record) => record.name));

  for (const name of parseAssignedEnvironmentNames(envExample)) {
    assert.ok(registryNames.has(name), `${name} is documented in .env.example but missing from the configuration contract`);
  }
});

test("every start-worker forwarded key has a canonical metadata record", async () => {
  const source = await readFile(new URL("scripts/start-worker.mjs", repositoryRoot), "utf8");
  const forwardedBlock = source.match(/const forwardedKeys = \[(.*?)\];/s)?.[1];
  assert.ok(forwardedBlock, "start-worker forwardedKeys block must remain discoverable");

  const registryNames = new Set(PORTAL_CONFIGURATION_CONTRACT.map((record) => record.name));
  const forwardedKeys = [...forwardedBlock.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1]);
  for (const name of forwardedKeys) {
    assert.ok(registryNames.has(name), `${name} is forwarded by start-worker but missing from the configuration contract`);
  }
});

test("secret configuration records never permit status exposure", () => {
  for (const record of PORTAL_CONFIGURATION_CONTRACT.filter((item) => item.secret)) {
    assert.equal(record.exposure, "never", `${record.name} is secret and must not be exposed through bounded status metadata`);
  }
});

test("recovery variables are explicitly isolated from production configuration", () => {
  const recovery = PORTAL_CONFIGURATION_CONTRACT.filter((record) => record.class === "recovery");
  assert.deepEqual(
    recovery.map((record) => record.name).sort(),
    ["PORTAL_RECOVERY_DIR", "PORTAL_RECOVERY_GID", "PORTAL_RECOVERY_SECRETS_DIR", "PORTAL_RECOVERY_UID"],
  );
});
